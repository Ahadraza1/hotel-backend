const crypto = require("crypto");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");
const User = require("../user/user.model");
const RefreshToken = require("./refreshToken.model");
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

const normalizeInvitedRole = (role) => {
  const legacyRoleMap = {
    HR: "HR_MANAGER",
    RESTAURANT: "RESTAURANT_MANAGER",
  };

  return legacyRoleMap[role] || role;
};

const findRoleForInvite = async (normalizedRole) => {
  const roleNameWithSpaces = normalizedRole.replace(/_/g, " ");
  const roleNameRegex = new RegExp(
    `^${roleNameWithSpaces.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i",
  );

  return Role.findOne({
    $or: [
      { normalizedName: normalizedRole },
      { normalizedName: roleNameWithSpaces.toUpperCase().replace(/\s+/g, "_") },
      { name: normalizedRole },
      { name: roleNameWithSpaces },
      { name: roleNameRegex },
    ],
  }).populate("permissions", "name key");
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
    const plan = await subscriptionService.getPlanById(
      signupPayload.selectedPlanId,
    );

    if (!subscriptionService.isFreePlan(plan, signupPayload.billingCycle)) {
      return res.status(400).json({
        message:
          "Selected plan requires payment. Please complete payment first.",
      });
    }

    const result = await createOrganizationWithSubscription({
      signupPayload,
      plan,
      payment: { provider: "free" },
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
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(500).json({ message: "Razorpay is not configured" });
    }

    const signupPayload = sanitizeSignupPayload(req.body);
    const plan = await subscriptionService.getPlanById(
      signupPayload.selectedPlanId,
    );

    if (subscriptionService.isFreePlan(plan, signupPayload.billingCycle)) {
      return res.status(400).json({
        message: "Selected plan does not require payment",
      });
    }

    const amount = subscriptionService.getPlanAmount(
      plan,
      signupPayload.billingCycle,
    );

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: process.env.RAZORPAY_CURRENCY || "INR",
      receipt: `signup_${Date.now()}`.slice(0, 40),
      notes: {
        planId: String(plan._id),
        billingCycle: signupPayload.billingCycle,
        adminEmail: signupPayload.adminEmail,
      },
    });

    res.status(200).json({
      data: {
        key: process.env.RAZORPAY_KEY_ID,
        order,
        amount,
        billingCycle: signupPayload.billingCycle,
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
    const signupPayload = sanitizeSignupPayload(req.body);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        message: "Incomplete payment verification payload",
      });
    }

    const plan = await subscriptionService.getPlanById(
      signupPayload.selectedPlanId,
    );

    if (subscriptionService.isFreePlan(plan, signupPayload.billingCycle)) {
      return res.status(400).json({
        message: "Free plan does not require payment verification",
      });
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
      String(order.notes?.billingCycle || "") !== signupPayload.billingCycle
    ) {
      return res.status(400).json({
        message: "Payment details do not match the selected plan",
      });
    }

    const result = await createOrganizationWithSubscription({
      signupPayload,
      plan,
      payment: {
        provider: "razorpay",
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
      },
    });

    res.status(201).json({
      message: "Organization registered successfully",
      redirect: "/login",
      data: result,
    });
  } catch (error) {
    console.error("SIGNUP CHECKOUT VERIFY ERROR:", error);
    res.status(400).json({
      message: error.message || "Payment failed. Please try again.",
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

    const invite = await Invitation.findOne({
      token,
      expiresAt: { $gt: new Date() },
    });

    if (!invite) {
      return res.status(400).json({
        message: "Invalid or expired invite token",
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

    const roleDoc = await findRoleForInvite(normalizedRole);

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
        department: getDepartmentFromRole(normalizedRole),
        designation: normalizedRole,
        salary: invite.salary || 0,
        joiningDate: new Date(),
        createdBy: user._id,
        isDeleted: false,
      });
    } else {
      existingStaff.userId = user._id;
      existingStaff.isActive = true;
      existingStaff.isDeleted = false;
      existingStaff.deletedAt = null;
      existingStaff.createdBy = user._id;
      await existingStaff.save();
    }

    await Invitation.deleteOne({ _id: invite._id });

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
