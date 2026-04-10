const crypto = require("crypto");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");
const User = require("../user/user.model");
const RefreshToken = require("./refreshToken.model");
const SignupCheckout = require("./signupCheckout.model");
const generateAccessToken = require("../../utils/generateToken");
const generateRefreshToken = require("../../utils/generateRefreshToken");
const Role = require("../rbac/role.model");
const Invitation = require("../invitation/invitation.model");
const Staff = require("../hr/staff.model");
const auditService = require("../audit/audit.service");
const Organization = require("../organization/organization.model");
const OrganizationSubscription = require("../subscription/organizationSubscription.model");
const SubscriptionPayment = require("../subscription/subscriptionPayment.model");
const subscriptionService = require("../subscription/subscription.service");
const {
  resolveUserPermissions,
} = require("../../utils/resolveUserPermissions");
const {
  assertUserWorkspaceIsActive,
  ensureActiveBranch,
  ensureActiveOrganization,
} = require("../../utils/workspaceScope");
const { sendPasswordResetOtpEmail } = require("../../utils/sendEmail");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PLAN_ALIASES = {
  BASIC: "STARTER",
  STARTER: "STARTER",
  PRO: "PROFESSIONAL",
  PROFESSIONAL: "PROFESSIONAL",
  ENTERPRISE: "ENTERPRISE",
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const SIGNUP_CHECKOUT_EXPIRY_MS = 2 * 60 * 60 * 1000;
const PASSWORD_RESET_OTP_EXPIRY_MS = 5 * 60 * 1000;
const USER_INVITE_EXPIRY_MS = 10 * 60 * 1000;

const normalizeEmail = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase();

const generateNumericOtp = (length = 6) =>
  Array.from({ length }, () => crypto.randomInt(0, 10)).join("");

const hashOtp = (otp) =>
  crypto.createHash("sha256").update(String(otp)).digest("hex");

const normalizeInvitedRole = (role) => {
  const legacyRoleMap = {
    HR: "HR_MANAGER",
    RESTAURANT: "RESTAURANT_MANAGER",
  };

  return legacyRoleMap[role] || role;
};

const normalizeScopeId = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const findRoleForInvite = async (
  normalizedRole,
  { organizationId = null, branchId = null } = {},
) => {
  const roleNameWithSpaces = normalizedRole.replace(/_/g, " ");
  const roleNameRegex = new RegExp(
    `^${roleNameWithSpaces.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i",
  );
  const normalizedOrganizationId = normalizeScopeId(organizationId);
  const normalizedBranchId = normalizeScopeId(branchId);
  const nameFilter = {
    $or: [
      { normalizedName: normalizedRole },
      { normalizedName: roleNameWithSpaces.toUpperCase().replace(/\s+/g, "_") },
      { name: normalizedRole },
      { name: roleNameWithSpaces },
      { name: roleNameRegex },
    ],
  };
  const scopedQueries = [
    ...(normalizedOrganizationId && normalizedBranchId
      ? [{ ...nameFilter, organizationId: normalizedOrganizationId, branchId: normalizedBranchId }]
      : []),
    ...(normalizedOrganizationId
      ? [
          {
            ...nameFilter,
            organizationId: normalizedOrganizationId,
            $and: [{ $or: [{ branchId: null }, { branchId: { $exists: false } }, { branchId: "" }] }],
          },
        ]
      : []),
    {
      ...nameFilter,
      organizationId: null,
      $and: [{ $or: [{ branchId: null }, { branchId: { $exists: false } }, { branchId: "" }] }],
    },
    nameFilter,
  ];

  for (const query of scopedQueries) {
    const roleDoc = await Role.findOne(query).populate("permissions", "name key");
    if (roleDoc) {
      return roleDoc;
    }
  }

  return null;
};

const getDepartmentFromRole = (role) => {
  const roleDepartmentMap = {
    RECEPTIONIST: "FRONT_OFFICE",
    HOUSEKEEPING: "HOUSEKEEPING",
    ACCOUNTANT: "FINANCE",
    HR_MANAGER: "HR",
    RESTAURANT_MANAGER: "RESTAURANT",
    WAITER: "RESTAURANT",
    CHEF: "RESTAURANT",
    BRANCH_MANAGER: "MANAGEMENT",
  };

  return roleDepartmentMap[role] || "MANAGEMENT";
};

const normalizePlanCode = (value) =>
  PLAN_ALIASES[
    String(value || "")
      .trim()
      .toUpperCase()
  ] || "STARTER";

const sanitizeSignupPayload = (payload = {}) => {
  const organizationName = String(payload.organizationName || "").trim();
  const businessType = String(payload.businessType || "")
    .trim()
    .toUpperCase();
  const country = String(payload.country || "").trim();
  const state = String(payload.state || "").trim();
  const city = String(payload.city || "").trim();
  const fullBusinessAddress = String(payload.fullBusinessAddress || "").trim();
  const taxId = String(payload.taxId || "").trim();
  const contactPhone = String(payload.contactPhone || "").trim();
  const adminFullName = String(payload.adminFullName || "").trim();
  const adminEmail = String(payload.adminEmail || "")
    .trim()
    .toLowerCase();
  const adminPhone = String(payload.adminPhone || "").trim();
  const password = String(payload.password || "");
  const selectedPlanId = String(payload.selectedPlanId || "").trim();
  const billingCycle = payload.billingCycle === "yearly" ? "yearly" : "monthly";
  const parsedBranches =
    payload.numberOfBranches === "" ||
    payload.numberOfBranches === undefined ||
    payload.numberOfBranches === null
      ? null
      : Number(payload.numberOfBranches);

  if (
    !organizationName ||
    !businessType ||
    !country ||
    !state ||
    !city ||
    !fullBusinessAddress ||
    !contactPhone ||
    !adminFullName ||
    !adminEmail ||
    !password ||
    !selectedPlanId
  ) {
    throw new Error("All required fields must be provided");
  }

  if (!emailRegex.test(adminEmail)) {
    throw new Error("A valid work email address is required");
  }

  if (!passwordRegex.test(password)) {
    throw new Error(
      "Password must be at least 8 characters and include an uppercase letter, number, and symbol",
    );
  }

  if (
    parsedBranches !== null &&
    (!Number.isFinite(parsedBranches) || parsedBranches < 1)
  ) {
    throw new Error("Number of branches must be at least 1");
  }

  return {
    organizationName,
    businessType,
    numberOfBranches: parsedBranches,
    country,
    state,
    city,
    fullBusinessAddress,
    taxId: taxId || null,
    contactPhone,
    adminFullName,
    adminEmail,
    adminPhone: adminPhone || null,
    password,
    selectedPlanId,
    billingCycle,
  };
};

const sanitizeCheckoutPayload = (payload = {}) => {
  const customerName = String(payload.customerName || payload.name || "").trim();
  const userEmail = String(payload.userEmail || payload.email || "")
    .trim()
    .toLowerCase();
  const selectedPlanId = String(payload.selectedPlanId || payload.planId || "").trim();
  const billingCycle = payload.billingCycle === "yearly" ? "yearly" : "monthly";

  if (!customerName || !userEmail || !selectedPlanId) {
    throw new Error("Name, email, and selected plan are required");
  }

  if (!emailRegex.test(userEmail)) {
    throw new Error("A valid work email address is required");
  }

  return {
    customerName,
    userEmail,
    selectedPlanId,
    billingCycle,
  };
};

const serializeSignupCheckout = (checkoutDoc) => ({
  checkoutReference: checkoutDoc.checkoutReference,
  planId: String(checkoutDoc.planId),
  planName: checkoutDoc.planSnapshot?.name || "",
  price: Number(checkoutDoc.amount || 0),
  billingCycle: checkoutDoc.billingCycle,
  email: checkoutDoc.userEmail,
  name: checkoutDoc.customerName || "",
  paymentStatus:
    checkoutDoc.status === "success" || checkoutDoc.status === "consumed"
      ? "success"
      : checkoutDoc.status,
  paymentId: checkoutDoc.paymentId || null,
  orderId: checkoutDoc.orderId || null,
  provider: checkoutDoc.provider || null,
});

const buildSignupCheckoutResponse = (checkoutDoc) => ({
  ...serializeSignupCheckout(checkoutDoc),
  paymentReference: {
    checkoutReference: checkoutDoc.checkoutReference,
    paymentId: checkoutDoc.paymentId || null,
    orderId: checkoutDoc.orderId || null,
    provider: checkoutDoc.provider || null,
  },
});

const getValidSignupCheckout = async (checkoutReference, allowedStatuses = ["success"]) => {
  const normalizedReference = String(checkoutReference || "").trim();

  if (!normalizedReference) {
    throw new Error("Checkout reference is required");
  }

  const checkoutDoc = await SignupCheckout.findOne({
    checkoutReference: normalizedReference,
  });

  if (!checkoutDoc) {
    throw new Error("Payment session not found");
  }

  if (
    checkoutDoc.expiresAt &&
    new Date(checkoutDoc.expiresAt).getTime() < Date.now()
  ) {
    throw new Error("Payment session expired. Please start again.");
  }

  if (!allowedStatuses.includes(checkoutDoc.status)) {
    throw new Error("Payment has not been completed successfully");
  }

  return checkoutDoc;
};

const reserveSystemIdentifier = async (organizationName) => {
  const base = organizationName
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 20);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate =
      `${base || "ORG"}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

    const existing = await Organization.findOne({
      systemIdentifier: candidate,
    }).lean();

    if (!existing) {
      return candidate;
    }
  }

  throw new Error(
    "Please try again. Unable to reserve organization identifier.",
  );
};

const createOrganizationWithSubscription = async ({
  signupPayload,
  plan,
  payment,
  checkoutDoc = null,
}) => {
  const session = await mongoose.startSession();

  try {
    const existingUser = await User.findOne({
      email: signupPayload.adminEmail,
    }).lean();

    if (existingUser) {
      throw new Error("A user with this email already exists");
    }

    const systemIdentifier = await reserveSystemIdentifier(
      signupPayload.organizationName,
    );
    const adminId = new mongoose.Types.ObjectId();
    const organizationId = uuidv4();
    const isFreeTrialPlan = subscriptionService.isFreePlan(
      plan,
      signupPayload.billingCycle,
    );
    const now = new Date();
    const trialEndDate = isFreeTrialPlan
      ? subscriptionService.addTrialPeriod(now)
      : null;
    const subscriptionEndDate = isFreeTrialPlan
      ? null
      : subscriptionService.addBillingCycle(now, signupPayload.billingCycle);
    const planSnapshot = subscriptionService.buildPlanSnapshot(plan);

    session.startTransaction();

    const organization = new Organization({
      organizationId,
      name: signupPayload.organizationName,
      businessType: signupPayload.businessType,
      numberOfBranches: signupPayload.numberOfBranches,
      country: signupPayload.country,
      state: signupPayload.state,
      city: signupPayload.city,
      systemIdentifier,
      headquartersAddress: signupPayload.fullBusinessAddress,
      taxId: signupPayload.taxId,
      contactPhone: signupPayload.contactPhone,
      serviceTier: normalizePlanCode(plan.name),
      currency: "USD",
      timezone: "UTC",
      createdBy: adminId,
    });

    const adminUser = new User({
      _id: adminId,
      organizationId,
      branchId: null,
      role: "CORPORATE_ADMIN",
      isPlatformAdmin: false,
      name: signupPayload.adminFullName,
      email: signupPayload.adminEmail,
      phone: signupPayload.adminPhone,
      password: signupPayload.password,
      isActive: true,
    });

    await organization.save({ session });
    await adminUser.save({ session });

    await OrganizationSubscription.create(
      [
        {
          organizationId,
          planId: plan._id,
          billingCycle: signupPayload.billingCycle,
          trialStartDate: isFreeTrialPlan ? now : null,
          trialEndDate,
          subscriptionStartDate: isFreeTrialPlan ? null : now,
          subscriptionEndDate,
          subscriptionStatus: isFreeTrialPlan ? "trial" : "active",
          paymentStatus: isFreeTrialPlan ? "not_required" : "success",
          planSnapshot,
          payment: payment || { provider: isFreeTrialPlan ? "free" : "manual" },
          assignedBy: adminId,
        },
      ],
      { session },
    );

    await SubscriptionPayment.create(
      [
        {
          organizationId,
          planId: plan._id,
          billingCycle: signupPayload.billingCycle,
          amount: subscriptionService.getPlanAmount(
            plan,
            signupPayload.billingCycle,
          ),
          status: "success",
          paymentDate: now,
          provider: payment?.provider || (isFreeTrialPlan ? "free" : "manual"),
          orderId: payment?.orderId || null,
          paymentId: payment?.paymentId || null,
          signature: payment?.signature || null,
          assignedBy: adminId,
        },
      ],
      { session },
    );

    if (checkoutDoc) {
      checkoutDoc.status = "consumed";
      checkoutDoc.consumedAt = now;
      await checkoutDoc.save({ session });
    }

    await session.commitTransaction();

    return {
      organizationId,
      organizationName: organization.name,
      adminEmail: adminUser.email,
      isFreeTrialPlan,
    };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    throw error;
  } finally {
    session.endSession();
  }
};

const getSubscriptionAccessForUser = async (user) => {
  if (!user?.organizationId || user.isPlatformAdmin) {
    return null;
  }

  return subscriptionService.getSubscriptionAccessForOrganization(
    user.organizationId,
  );
};

/*
  PLATFORM SUPER ADMIN REGISTRATION
*/
exports.registerSuperAdmin = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const user = await User.create({
      organizationId: null,
      branchId: null,
      role: "SUPER_ADMIN",
      isPlatformAdmin: true,
      name,
      email,
      password,
    });

    const payload = {
      id: user._id,
      userId: user._id,
      role: user.role,
      organizationId: user.organizationId,
      branchId: user.branchId,
      isPlatformAdmin: user.isPlatformAdmin,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.status(201).json({
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        subscriptionAccess: null,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Registration failed" });
  }
};

exports.getSignupPlans = async (req, res) => {
  try {
    const plans = await subscriptionService.listPlans(null);
    res.status(200).json({ data: plans });
  } catch (error) {
    console.error("GET SIGNUP PLANS ERROR:", error);
    res.status(500).json({ message: "Failed to load signup plans" });
  }
};

exports.registerOrganization = async (req, res) => {
  try {
    const signupPayload = sanitizeSignupPayload(req.body);
    const checkoutDoc = await getValidSignupCheckout(req.body.checkoutReference, [
      "success",
    ]);

    if (signupPayload.adminEmail !== checkoutDoc.userEmail) {
      return res.status(400).json({
        message:
          "Corporate admin email must match the successful payment email.",
      });
    }

    const plan = await subscriptionService.getPlanById(String(checkoutDoc.planId));

    signupPayload.selectedPlanId = String(checkoutDoc.planId);
    signupPayload.billingCycle = checkoutDoc.billingCycle;

    const result = await createOrganizationWithSubscription({
      signupPayload,
      plan,
      payment: {
        provider: checkoutDoc.provider || "razorpay",
        orderId: checkoutDoc.orderId || null,
        paymentId: checkoutDoc.paymentId || null,
        signature: checkoutDoc.signature || null,
      },
      checkoutDoc,
    });

    res.status(201).json({
      message: "Organization registered successfully",
      redirect: "/login",
      data: result,
    });
  } catch (error) {
    console.error("REGISTER ORGANIZATION ERROR:", error);
    res.status(500).json({
      message: error.message || "Failed to register organization",
    });
  }
};

exports.createSignupCheckoutOrder = async (req, res) => {
  try {
    const checkoutPayload = sanitizeCheckoutPayload(req.body);
    const plan = await subscriptionService.getPlanById(
      checkoutPayload.selectedPlanId,
    );

    const amount = subscriptionService.getPlanAmount(
      plan,
      checkoutPayload.billingCycle,
    );
    const checkoutReference = uuidv4();
    const expiresAt = new Date(Date.now() + SIGNUP_CHECKOUT_EXPIRY_MS);
    const baseCheckoutData = {
      checkoutReference,
      customerName: checkoutPayload.customerName,
      userEmail: checkoutPayload.userEmail,
      planId: plan._id,
      planSnapshot: subscriptionService.buildPlanSnapshot(plan),
      billingCycle: checkoutPayload.billingCycle,
      amount,
      expiresAt,
    };

    if (subscriptionService.isFreePlan(plan, checkoutPayload.billingCycle)) {
      const freeCheckout = await SignupCheckout.create({
        ...baseCheckoutData,
        provider: "free",
        status: "success",
        paymentId: `free_${Date.now()}`,
        verifiedAt: new Date(),
      });

      return res.status(200).json({
        data: {
          paymentRequired: false,
          ...buildSignupCheckoutResponse(freeCheckout),
          plan: await subscriptionService.getSerializedPlanById(plan._id),
        },
      });
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({ message: "Razorpay is not configured" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: process.env.RAZORPAY_CURRENCY || "INR",
      receipt: `signup_${Date.now()}`.slice(0, 40),
      notes: {
        checkoutReference,
        planId: String(plan._id),
        billingCycle: checkoutPayload.billingCycle,
        adminEmail: checkoutPayload.userEmail,
      },
    });

    await SignupCheckout.create({
      ...baseCheckoutData,
      provider: "razorpay",
      status: "pending",
      orderId: order.id,
    });

    res.status(200).json({
      data: {
        paymentRequired: true,
        checkoutReference,
        key: process.env.RAZORPAY_KEY_ID,
        order,
        amount,
        billingCycle: checkoutPayload.billingCycle,
        plan: await subscriptionService.getSerializedPlanById(plan._id),
      },
    });
  } catch (error) {
    console.error("SIGNUP CHECKOUT ORDER ERROR:", error);
    res.status(400).json({
      message: error.message || "Failed to create checkout order",
    });
  }
};

exports.verifySignupCheckout = async (req, res) => {
  try {
    const checkoutPayload = sanitizeCheckoutPayload(req.body);
    const checkoutDoc = await getValidSignupCheckout(req.body.checkoutReference, [
      "pending",
    ]);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        message: "Incomplete payment verification payload",
      });
    }

    const plan = await subscriptionService.getPlanById(
      checkoutPayload.selectedPlanId,
    );

    if (String(checkoutDoc.planId) !== String(plan._id)) {
      return res.status(400).json({ message: "Selected plan mismatch" });
    }

    if (checkoutDoc.userEmail !== checkoutPayload.userEmail) {
      return res.status(400).json({ message: "Checkout email mismatch" });
    }

    if (checkoutDoc.billingCycle !== checkoutPayload.billingCycle) {
      return res.status(400).json({ message: "Billing cycle mismatch" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        message: "Payment signature verification failed",
      });
    }

    const order = await razorpay.orders.fetch(razorpay_order_id);

    if (!order?.id) {
      return res.status(400).json({
        message: "Payment order not found",
      });
    }

    if (
      String(order.notes?.planId || "") !== String(plan._id) ||
      String(order.notes?.billingCycle || "") !== checkoutPayload.billingCycle
    ) {
      return res.status(400).json({
        message: "Payment details do not match the selected plan",
      });
    }

    checkoutDoc.customerName = checkoutPayload.customerName;
    checkoutDoc.provider = "razorpay";
    checkoutDoc.orderId = razorpay_order_id;
    checkoutDoc.paymentId = razorpay_payment_id;
    checkoutDoc.signature = razorpay_signature;
    checkoutDoc.status = "success";
    checkoutDoc.verifiedAt = new Date();
    checkoutDoc.failureReason = null;
    await checkoutDoc.save();

    res.status(200).json({
      message: "Payment verified successfully",
      data: buildSignupCheckoutResponse(checkoutDoc),
    });
  } catch (error) {
    console.error("SIGNUP CHECKOUT VERIFY ERROR:", error);
    res.status(400).json({
      message: error.message || "Payment failed. Please try again.",
    });
  }
};

exports.markSignupCheckoutFailed = async (req, res) => {
  try {
    const checkoutReference = String(req.body.checkoutReference || "").trim();

    if (!checkoutReference) {
      return res.status(400).json({ message: "Checkout reference is required" });
    }

    const checkoutDoc = await SignupCheckout.findOne({ checkoutReference });

    if (!checkoutDoc) {
      return res.status(404).json({ message: "Payment session not found" });
    }

    checkoutDoc.status = "failed";
    checkoutDoc.failureReason = String(
      req.body.failureReason ||
        req.body.error?.description ||
        req.body.error?.reason ||
        "Payment failed",
    ).trim();

    if (req.body.orderId) {
      checkoutDoc.orderId = String(req.body.orderId);
    }

    await checkoutDoc.save();

    res.status(200).json({
      message: "Payment failure recorded",
      data: buildSignupCheckoutResponse(checkoutDoc),
    });
  } catch (error) {
    console.error("SIGNUP CHECKOUT FAILURE ERROR:", error);
    res.status(400).json({
      message: error.message || "Failed to record payment failure",
    });
  }
};

exports.getSignupCheckoutSession = async (req, res) => {
  try {
    const checkoutDoc = await getValidSignupCheckout(
      req.params.checkoutReference || req.query.checkoutReference,
      ["success"],
    );

    res.status(200).json({
      data: buildSignupCheckoutResponse(checkoutDoc),
    });
  } catch (error) {
    res.status(400).json({
      message: error.message || "Failed to load payment session",
    });
  }
};

/*
  LOGIN
*/
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: "Account is deactivated" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    try {
      await assertUserWorkspaceIsActive(user);
    } catch (workspaceError) {
      return res.status(403).json({ message: workspaceError.message });
    }

    const { permissions, roleDoc } = await resolveUserPermissions(user);
    const subscriptionAccess = await getSubscriptionAccessForUser(user);

    console.log("LOGIN ROLE DATA", {
      userId: user._id?.toString(),
      email: user.email,
      role: user.role,
      roleRef: user.roleRef || null,
      roleData: roleDoc
        ? {
            id: roleDoc._id?.toString(),
            name: roleDoc.name,
            normalizedName: roleDoc.normalizedName,
            permissionCount: Array.isArray(roleDoc.permissions)
              ? roleDoc.permissions.length
              : 0,
          }
        : null,
    });

    console.log("LOGIN PERMISSIONS", {
      userId: user._id?.toString(),
      email: user.email,
      role: user.role,
      roleRef: user.roleRef || roleDoc?._id || null,
      permissions,
      permissionCount: permissions.length,
    });

    if (permissions.length === 0) {
      console.warn("LOGIN PERMISSIONS EMPTY", {
        userId: user._id?.toString(),
        email: user.email,
        role: user.role,
      });
    }

    const payload = {
      id: user._id,
      userId: user._id,
      role: user.role,
      permissions,
      roleRef: user.roleRef || roleDoc?._id || null,
      organizationId: user.organizationId,
      branchId: user.branchId,
      isPlatformAdmin: user.isPlatformAdmin,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await auditService.logAction({
      user: payload,
      action: "LOGIN",
      module: "AUTH",
      metadata: {
        email: user.email,
        subscriptionStatus: subscriptionAccess?.subscriptionStatus || null,
      },
      req,
    });

    res.json({
      accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions,
        roleRef: user.roleRef || roleDoc?._id || null,
        organizationId: user.organizationId,
        branchId: user.branchId,
        isPlatformAdmin: user.isPlatformAdmin,
        subscriptionAccess,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Login failed" });
  }
};

exports.sendPasswordResetOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ message: "Your email is not correct" });
    }

    const user = await User.findOne({
      email,
      isDeleted: { $ne: true },
    }).select("+passwordResetOtpHash");

    if (!user) {
      return res.status(404).json({ message: "Your email is not correct" });
    }

    const otp = generateNumericOtp(6);
    user.passwordResetOtpHash = hashOtp(otp);
    user.passwordResetOtpExpiresAt = new Date(
      Date.now() + PASSWORD_RESET_OTP_EXPIRY_MS,
    );
    user.passwordResetOtpVerifiedAt = null;
    await user.save();

    await sendPasswordResetOtpEmail(user.email, otp);

    return res.status(200).json({
      message: "OTP sent successfully",
    });
  } catch (error) {
    console.error("SEND PASSWORD RESET OTP ERROR:", error);
    return res.status(500).json({
      message: "Failed to send OTP",
    });
  }
};

exports.verifyPasswordResetOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").trim();

    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ message: "Your email is not correct" });
    }

    if (!/^\d{4}$|^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    const user = await User.findOne({
      email,
      isDeleted: { $ne: true },
    }).select("+passwordResetOtpHash");

    if (
      !user ||
      !user.passwordResetOtpHash ||
      !user.passwordResetOtpExpiresAt ||
      user.passwordResetOtpExpiresAt.getTime() < Date.now() ||
      user.passwordResetOtpHash !== hashOtp(otp)
    ) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    user.passwordResetOtpVerifiedAt = new Date();
    await user.save();

    return res.status(200).json({
      message: "OTP verified successfully",
    });
  } catch (error) {
    console.error("VERIFY PASSWORD RESET OTP ERROR:", error);
    return res.status(500).json({
      message: "Failed to verify OTP",
    });
  }
};

exports.resetPasswordWithOtp = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const newPassword = String(req.body?.newPassword || "");

    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ message: "Your email is not correct" });
    }

    if (!newPassword) {
      return res.status(400).json({
        message: "New password is required",
      });
    }

    const user = await User.findOne({
      email,
      isDeleted: { $ne: true },
    }).select("+password +passwordResetOtpHash");

    if (!user) {
      return res.status(404).json({ message: "Your email is not correct" });
    }

    if (!user.passwordResetOtpVerifiedAt) {
      return res.status(400).json({
        message: "OTP verification required",
      });
    }

    if (
      user.passwordResetOtpExpiresAt &&
      user.passwordResetOtpExpiresAt.getTime() < Date.now()
    ) {
      user.passwordResetOtpHash = null;
      user.passwordResetOtpExpiresAt = null;
      user.passwordResetOtpVerifiedAt = null;
      await user.save();

      return res.status(400).json({
        message: "Invalid OTP",
      });
    }

    user.password = newPassword;
    user.passwordResetOtpHash = null;
    user.passwordResetOtpExpiresAt = null;
    user.passwordResetOtpVerifiedAt = null;
    await user.save();

    return res.status(200).json({
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("RESET PASSWORD WITH OTP ERROR:", error);
    return res.status(500).json({
      message: "Failed to reset password",
    });
  }
};

/*
  ACCEPT INVITE
*/
exports.acceptInvite = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        message: "Token and password are required",
      });
    }

    if (!passwordRegex.test(String(password))) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include an uppercase letter, number, and symbol",
      });
    }

    const invitedUser = await User.findOne({
      inviteToken: token,
      isDeleted: { $ne: true },
    }).select("+password");

    if (invitedUser) {
      if (invitedUser.isActive) {
        return res.status(400).json({
          message: "Token already used",
        });
      }

      if (
        !invitedUser.inviteExpiresAt ||
        invitedUser.inviteExpiresAt.getTime() <= Date.now()
      ) {
        return res.status(400).json({
          message: "Token expired",
        });
      }

      const hashedPassword = await bcrypt.hash(String(password), 10);
      const updateResult = await User.updateOne(
        {
          _id: invitedUser._id,
          inviteToken: token,
          isActive: false,
          inviteExpiresAt: { $gt: new Date() },
        },
        {
          $set: {
            password: hashedPassword,
            isActive: true,
            inviteToken: null,
            inviteExpiresAt: null,
          },
        },
      );

      if (updateResult.modifiedCount === 0) {
        return res.status(400).json({
          message: "Token already used",
        });
      }

      return res.status(200).json({
        message: "Account activated successfully",
        redirect: "/login",
        email: invitedUser.email,
      });
    }

    const invite = await Invitation.findOne({ token });

    if (!invite) {
      return res.status(400).json({
        message: "Invalid token",
      });
    }

    if (invite.isAccepted || ["accepted", "ACCEPTED"].includes(invite.status)) {
      return res.status(400).json({
        message: "Token already used",
      });
    }

    if (invite.expiresAt <= new Date()) {
      invite.status = "EXPIRED";
      invite.isAccepted = false;
      await invite.save();

      return res.status(400).json({
        message: "Token expired",
      });
    }

    const activeOrganization = invite.organizationId
      ? await ensureActiveOrganization(invite.organizationId)
      : null;
    const activeBranch = invite.branchId
      ? await ensureActiveBranch(invite.branchId)
      : null;

    if (
      (invite.organizationId && !activeOrganization) ||
      (invite.branchId && !activeBranch)
    ) {
      return res.status(400).json({
        message: "Invitation is no longer valid",
      });
    }

    const normalizedRole = normalizeInvitedRole(invite.role);
    const existingUser = await User.findOne({ email: invite.email });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists with this email",
      });
    }

    const roleDoc = await findRoleForInvite(normalizedRole, {
      organizationId: invite.organizationId || null,
      branchId: invite.branchId || null,
    });

    if (!roleDoc) {
      return res.status(400).json({
        message: `Role not found: ${normalizedRole}`,
      });
    }

    const user = new User({
      name: invite.name,
      email: invite.email,
      password,
      role: normalizedRole,
      roleRef: roleDoc._id,
      organizationId: invite.organizationId || null,
      branchId: invite.branchId || null,
      permissions: Array.isArray(roleDoc?.permissions)
        ? roleDoc.permissions
            .map((permission) => permission.key || permission.name)
            .filter(Boolean)
        : [],
      isActive: true,
    });

    await user.save();

    const existingStaff = await Staff.findOne({
      email: invite.email,
      branchId: invite.branchId,
    });

    if (!existingStaff) {
      const nameParts = invite.name.trim().split(/\s+/);
      const firstName = nameParts[0] || invite.name;
      const lastName = nameParts.slice(1).join(" ");

      await Staff.create({
        organizationId: invite.organizationId,
        branchId: invite.branchId,
        userId: user._id,
        firstName,
        lastName,
        email: invite.email,
        phone: invite.phone || "",
        department: invite.department || getDepartmentFromRole(normalizedRole),
        designation: normalizedRole,
        shift: normalizeShift(invite.shift) || undefined,
        employmentType: normalizeEmploymentType(invite.employmentType),
        status: "Active",
        salary: invite.salary || 0,
        joiningDate: invite.joinedDate || new Date(),
        createdBy: user._id,
        isDeleted: false,
      });
    } else {
      const nameParts = invite.name.trim().split(/\s+/);
      existingStaff.firstName = nameParts[0] || existingStaff.firstName;
      existingStaff.lastName =
        nameParts.slice(1).join(" ") || existingStaff.lastName;
      existingStaff.email = invite.email || existingStaff.email;
      existingStaff.userId = user._id;
      existingStaff.organizationId = invite.organizationId || existingStaff.organizationId;
      existingStaff.branchId = invite.branchId || existingStaff.branchId;
      existingStaff.phone = invite.phone || existingStaff.phone;
      existingStaff.department =
        invite.department || getDepartmentFromRole(normalizedRole);
      existingStaff.designation = normalizedRole;
      existingStaff.shift = normalizeShift(invite.shift) || existingStaff.shift;
      existingStaff.employmentType = normalizeEmploymentType(
        invite.employmentType,
      );
      existingStaff.salary = Number.isFinite(Number(invite.salary))
        ? Number(invite.salary)
        : existingStaff.salary;
      existingStaff.status = "Active";
      existingStaff.isActive = true;
      existingStaff.isDeleted = false;
      existingStaff.deletedAt = null;
      existingStaff.createdBy = user._id;
      await existingStaff.save();
    }

    invite.status = "ACCEPTED";
    invite.isAccepted = true;
    await invite.save();

    res.status(200).json({
      message: "Account activated successfully",
      redirect: "/login",
      email: user.email,
    });
  } catch (error) {
    console.error("ACCEPT INVITE ERROR:", error);

    res.status(500).json({
      message: "Failed to accept invite",
    });
  }
};

/*
  GET CURRENT AUTH USER
*/
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "roleRef",
      populate: {
        path: "permissions",
        select: "name key",
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    try {
      await assertUserWorkspaceIsActive(user);
    } catch (workspaceError) {
      return res.status(403).json({ message: workspaceError.message });
    }

    const { permissions, roleDoc } = await resolveUserPermissions(user);
    const subscriptionAccess = await getSubscriptionAccessForUser(user);

    console.log("AUTH ME ROLE DATA", {
      userId: user._id?.toString(),
      email: user.email,
      role: user.role,
      roleRef: user.roleRef || null,
      roleData: roleDoc
        ? {
            id: roleDoc._id?.toString(),
            name: roleDoc.name,
            normalizedName: roleDoc.normalizedName,
            permissionCount: Array.isArray(roleDoc.permissions)
              ? roleDoc.permissions.length
              : 0,
          }
        : null,
    });

    console.log("AUTH ME PERMISSIONS", {
      userId: user._id?.toString(),
      email: user.email,
      permissions,
      permissionCount: permissions.length,
    });

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions,
      roleRef: user.roleRef || roleDoc?._id || null,
      avatar: user.avatar || null,
      organizationId: user.organizationId || null,
      branchId: user.branchId || null,
      isPlatformAdmin: user.isPlatformAdmin || false,
      subscriptionAccess,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch profile" });
  }
};

/*
  UPDATE PROFILE
*/
exports.updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { name, email } = req.body;

    if (name) user.name = name;
    if (email) user.email = email;

    if (req.file) {
      user.avatar = `/uploads/${req.file.filename}`;
    }

    await user.save();

    res.json({ message: "Profile updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update profile" });
  }
};
