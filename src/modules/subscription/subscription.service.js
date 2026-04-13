const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { v4: uuidv4 } = require("uuid");
const Razorpay = require("razorpay");
const Branch = require("../branch/branch.model");
const Organization = require("../organization/organization.model");
const User = require("../user/user.model");
const SubscriptionPlan = require("./subscriptionPlan.model");
const OrganizationSubscription = require("./organizationSubscription.model");
const SubscriptionPayment = require("./subscriptionPayment.model");
const { getSystemSettings } = require("../systemSettings/systemSettings.store");
const {
  DEFAULT_CURRENCY,
  formatCurrency,
} = require("../../utils/currency");

const FIVE_DAYS_IN_MS = 5 * 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 14;
const SUBSCRIPTION_INVOICE_DIR = path.join(
  __dirname,
  "../../storage/subscription-invoices",
);
const DASHBOARD_ALLOWED_STATUSES = new Set(["active", "trial"]);
const PLAN_HIERARCHY = ["FREE", "BASIC", "PROFESSIONAL", "ENTERPRISE"];
const PLAN_NAME_ALIASES = {
  FREE: "FREE",
  TRIAL: "FREE",
  BASIC: "BASIC",
  STARTER: "BASIC",
  PROFESSIONAL: "PROFESSIONAL",
  PRO: "PROFESSIONAL",
  ENTERPRISE: "ENTERPRISE",
};

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const normalizeFeatures = (features) =>
  Array.isArray(features)
    ? [
        ...new Set(
          features.map((item) => String(item || "").trim()).filter(Boolean),
        ),
      ]
    : [];

const normalizeBranchLimit = (value) => {
  if (value === "" || value === undefined || value === null) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("Branch limit must be empty or greater than 0");
  }

  return parsed;
};

const sanitizePlanPayload = (payload) => {
  const name = String(payload.name || "").trim();

  if (!name) {
    throw new Error("Plan name is required");
  }

  const monthlyPrice = Number(payload.monthlyPrice);
  const yearlyPrice = Number(payload.yearlyPrice);

  if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
    throw new Error("Monthly price must be 0 or greater");
  }

  if (!Number.isFinite(yearlyPrice) || yearlyPrice < 0) {
    throw new Error("Yearly price must be 0 or greater");
  }

  return {
    name,
    description: String(payload.description || "").trim(),
    monthlyPrice,
    yearlyPrice,
    branchLimit: normalizeBranchLimit(payload.branchLimit),
    features: normalizeFeatures(payload.features),
    isActive: typeof payload.isActive === "boolean" ? payload.isActive : true,
  };
};

const buildPlanSnapshot = (plan) => ({
  name: plan.name,
  description: plan.description || "",
  monthlyPrice: Number(plan.monthlyPrice || 0),
  yearlyPrice: Number(plan.yearlyPrice || 0),
  branchLimit: plan.branchLimit ?? null,
  features: normalizeFeatures(plan.features),
});

const getPlanAmount = (plan, billingCycle) =>
  billingCycle === "yearly"
    ? Number(plan.yearlyPrice || 0)
    : Number(plan.monthlyPrice || 0);

const isFreePlan = (plan, billingCycle = "monthly") =>
  getPlanAmount(plan, billingCycle) === 0;

const normalizePlanHierarchyName = (name) =>
  PLAN_NAME_ALIASES[String(name || "").trim().toUpperCase()] || null;

const getPlanHierarchyIndex = (plan) => {
  const normalizedName = normalizePlanHierarchyName(plan?.name || plan);

  if (normalizedName) {
    return PLAN_HIERARCHY.indexOf(normalizedName);
  }

  return -1;
};

const comparePlans = (currentPlan, selectedPlan) => {
  const currentIndex = getPlanHierarchyIndex(currentPlan);
  const selectedIndex = getPlanHierarchyIndex(selectedPlan);

  if (currentIndex >= 0 && selectedIndex >= 0) {
    return selectedIndex - currentIndex;
  }

  const currentMonthlyPrice = Number(currentPlan?.monthlyPrice || 0);
  const selectedMonthlyPrice = Number(selectedPlan?.monthlyPrice || 0);

  if (selectedMonthlyPrice !== currentMonthlyPrice) {
    return selectedMonthlyPrice - currentMonthlyPrice;
  }

  const currentYearlyPrice = Number(currentPlan?.yearlyPrice || 0);
  const selectedYearlyPrice = Number(selectedPlan?.yearlyPrice || 0);

  if (selectedYearlyPrice !== currentYearlyPrice) {
    return selectedYearlyPrice - currentYearlyPrice;
  }

  return String(selectedPlan?.name || "").localeCompare(
    String(currentPlan?.name || ""),
  );
};

const assertUpgradeOnlySelection = async ({
  organizationId,
  selectedPlan,
  allowCurrentPlan = false,
  allowAnyPlanSelectionWhenInactive = false,
}) => {
  const currentSubscription = await getOrganizationSubscriptionDoc(organizationId);
  const currentPlan = currentSubscription?.planSnapshot;
  const currentStatus = currentSubscription?.subscriptionStatus;

  if (!currentPlan?.name) {
    return;
  }

  if (
    allowAnyPlanSelectionWhenInactive &&
    ["cancelled", "expired"].includes(currentStatus)
  ) {
    return;
  }

  const comparison = comparePlans(currentPlan, selectedPlan);

  if (comparison < 0) {
    throw new Error("Downgrade not allowed. You can only upgrade your plan.");
  }

  if (!allowCurrentPlan && comparison === 0) {
    throw new Error("This is already your current plan.");
  }
};

const addBillingCycle = (startDate, billingCycle) => {
  const nextDate = new Date(startDate);

  if (billingCycle === "yearly") {
    nextDate.setFullYear(nextDate.getFullYear() + 1);
  } else {
    nextDate.setMonth(nextDate.getMonth() + 1);
  }

  return nextDate;
};

const addTrialPeriod = (startDate, days = TRIAL_DAYS) => {
  const nextDate = new Date(startDate);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

const capitalize = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "-";
};

const formatDate = (value) => {
  if (!value) return null;

  return new Date(value).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const buildAddress = (organization) =>
  [
    organization?.headquartersAddress,
    organization?.city,
    organization?.state,
    organization?.country,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(", ") || "Not provided";

const resolveOrganizationContact = async (organizationId) => {
  const corporateAdmin = await User.findOne({
    organizationId,
    role: "CORPORATE_ADMIN",
  })
    .sort({ createdAt: 1 })
    .lean();

  return {
    email: corporateAdmin?.email || "",
    phone: corporateAdmin?.phone || "",
  };
};

const getBillingPeriod = (payment) => {
  const start =
    payment?.billingPeriodStart || payment?.paymentDate || payment?.createdAt || new Date();
  const end =
    payment?.billingPeriodEnd ||
    addBillingCycle(start, payment?.billingCycle === "yearly" ? "yearly" : "monthly");

  return {
    start: new Date(start),
    end: new Date(end),
  };
};

const ensureSubscriptionInvoiceDir = async () => {
  await fs.promises.mkdir(SUBSCRIPTION_INVOICE_DIR, { recursive: true });
};

const generateSubscriptionInvoicePdf = async ({
  organization,
  subscription,
  payment,
  currencyCode,
}) => {
  await ensureSubscriptionInvoiceDir();

  const filePath = path.join(SUBSCRIPTION_INVOICE_DIR, `${payment.invoiceId}.pdf`);
  const doc = new PDFDocument({ size: "A4", margin: 42 });
  const stream = fs.createWriteStream(filePath);
  const { start, end } = getBillingPeriod(payment);
  const subtotal = Number(payment.amount || 0);
  const taxAmount = Number(payment.taxAmount || 0);
  const total = subtotal + taxAmount;
  const accent = "#4169AF";
  const softBlue = "#EEF4FF";
  const softGreen = "#EEF8F2";
  const softGray = "#F5F7FA";
  const text = "#1F2937";
  const muted = "#6B7280";

  doc.pipe(stream);

  doc.rect(0, 0, doc.page.width, 16).fill(accent);
  doc.roundedRect(42, 42, doc.page.width - 84, 110, 24).fill(softBlue);

  doc
    .fillColor(text)
    .font("Helvetica-Bold")
    .fontSize(26)
    .text("Subscription Invoice", 60, 64);

  doc
    .fillColor(muted)
    .font("Helvetica")
    .fontSize(11)
    .text(`Invoice ID: ${payment.invoiceId}`, 60, 100)
    .text(`Payment Date: ${formatDate(payment.paymentDate) || "-"}`, 60, 118);

  doc
    .fillColor(accent)
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(organization.name || "Organization", 350, 70, {
      width: 180,
      align: "right",
    });

  doc
    .fillColor(muted)
    .font("Helvetica")
    .fontSize(10)
    .text(buildAddress(organization), 350, 98, {
      width: 180,
      align: "right",
    });

  let y = 182;
  const drawSection = (title, lines, tint) => {
    const sectionHeight = 118;
    doc.roundedRect(42, y, doc.page.width - 84, sectionHeight, 20).fill(tint);
    doc
      .fillColor(text)
      .font("Helvetica-Bold")
      .fontSize(13)
      .text(title, 60, y + 18);

    let lineY = y + 48;
    lines.forEach(([label, value], index) => {
      const x = index % 2 === 0 ? 60 : 310;
      const rowY = lineY + Math.floor(index / 2) * 30;

      doc
        .fillColor(muted)
        .font("Helvetica")
        .fontSize(9)
        .text(label, x, rowY);
      doc
        .fillColor(text)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(value, x, rowY + 12, {
          width: 180,
        });
    });

    y += sectionHeight + 18;
  };

  drawSection(
    "Organization Info",
    [
      ["Organization", organization.name || "-"],
      ["Email", organization.contactEmail || "-"],
      ["Phone", organization.contactPhone || "-"],
      ["Address", buildAddress(organization)],
    ],
    softGray,
  );

  drawSection(
    "Plan Details",
    [
      ["Plan", subscription?.activePlan?.name || subscription?.planSnapshot?.name || "-"],
      ["Billing Cycle", capitalize(payment.billingCycle)],
      ["Billing Period", `${formatDate(start)} - ${formatDate(end)}`],
      ["Status", capitalize(payment.status)],
    ],
    softGreen,
  );

  doc.roundedRect(42, y, doc.page.width - 84, 132, 20).fill("#FFFFFF");
  doc.strokeColor("#D7DFEA").lineWidth(1).roundedRect(42, y, doc.page.width - 84, 132, 20).stroke();
  doc
    .fillColor(text)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text("Amount Summary", 60, y + 18);

  const summaryLines = [
    ["Plan Amount", formatCurrency(subtotal, currencyCode)],
    ["GST / Tax", formatCurrency(taxAmount, currencyCode)],
    ["Total Paid", formatCurrency(total, currencyCode)],
  ];

  summaryLines.forEach(([label, value], index) => {
    const rowY = y + 52 + index * 24;
    doc
      .fillColor(muted)
      .font("Helvetica")
      .fontSize(10)
      .text(label, 60, rowY);
    doc
      .fillColor(text)
      .font(index === summaryLines.length - 1 ? "Helvetica-Bold" : "Helvetica")
      .fontSize(index === summaryLines.length - 1 ? 13 : 11)
      .text(value, 390, rowY, { width: 140, align: "right" });
  });

  y += 162;

  doc
    .fillColor(muted)
    .font("Helvetica")
    .fontSize(9)
    .text(
      "This invoice was generated by HotelDesk for subscription billing records.",
      42,
      y,
      { width: doc.page.width - 84, align: "center" },
    );

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return filePath;
};

const assertOrganizationAccess = async (user, organizationId) => {
  if (!organizationId) {
    throw new Error("Organization is required");
  }

  if (user.role !== "SUPER_ADMIN" && user.organizationId !== organizationId) {
    throw new Error("You do not have access to this organization");
  }

  const organization = await Organization.findOne({ organizationId }).lean();

  if (!organization) {
    throw new Error("Organization not found");
  }

  return organization;
};

const resolveRestrictionReason = ({
  status,
  branchLimitReached,
  isTrialPlan,
}) => {
  if (status === "trial" && !branchLimitReached) {
    return null;
  }

  if (status === "cancelled") {
    return "Your subscription has been cancelled. Please renew your subscription.";
  }

  if (status === "expired" && isTrialPlan) {
    return "Your trial has expired. Please upgrade your subscription.";
  }

  if (status === "expired") {
    return "Your subscription has expired. Please renew your subscription.";
  }

  if (branchLimitReached) {
    return "Branch limit reached. Upgrade your plan.";
  }

  return null;
};

const serializePlan = (plan) => ({
  _id: plan._id,
  name: plan.name,
  description: plan.description || "",
  monthlyPrice: plan.monthlyPrice,
  yearlyPrice: plan.yearlyPrice,
  branchLimit: plan.branchLimit ?? null,
  features: normalizeFeatures(plan.features),
  isActive: !!plan.isActive,
  isFreeTrialPlan: isFreePlan(plan, "monthly") && isFreePlan(plan, "yearly"),
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
});

const serializePublicPlan = (plan, index, plansLength) => ({
  _id: plan._id,
  name: plan.name,
  description: plan.description || "",
  monthlyPrice: Number(plan.monthlyPrice || 0),
  yearlyPrice: Number(plan.yearlyPrice || 0),
  billingCycle: "monthly",
  features: normalizeFeatures(plan.features),
  maxBranches: plan.branchLimit ?? null,
  isActive: !!plan.isActive,
  isPopular: plansLength >= 3 && index === 1,
});

const getOrganizationBranchCount = async (organizationId) =>
  Branch.countDocuments({ organizationId, isActive: { $ne: false } });

const recordSubscriptionPayment = async ({
  organizationId,
  plan,
  billingCycle,
  payment,
  assignedBy,
  paymentDate,
  status = "success",
}) => {
  const billingPeriodStart = paymentDate || new Date();
  const billingPeriodEnd = isFreePlan(plan, billingCycle)
    ? addTrialPeriod(billingPeriodStart)
    : addBillingCycle(billingPeriodStart, billingCycle);

  await SubscriptionPayment.create({
    organizationId,
    planId: plan?._id || null,
    billingCycle,
    amount: getPlanAmount(plan, billingCycle),
    status,
    paymentDate: paymentDate || new Date(),
    provider: payment?.provider || "manual",
    orderId: payment?.orderId || null,
    paymentId: payment?.paymentId || null,
    signature: payment?.signature || null,
    billingPeriodStart,
    billingPeriodEnd,
    taxAmount: Number(payment?.taxAmount || 0),
    assignedBy: assignedBy || null,
  });
};

const refreshSubscriptionStatus = async (subscriptionDoc) => {
  if (!subscriptionDoc) return null;

  const now = Date.now();
  let nextStatus = subscriptionDoc.subscriptionStatus;

  if (nextStatus !== "cancelled") {
    if (subscriptionDoc.subscriptionStatus === "trial") {
      const trialEnd = subscriptionDoc.trialEndDate
        ? new Date(subscriptionDoc.trialEndDate).getTime()
        : null;
      nextStatus = trialEnd && trialEnd < now ? "expired" : "trial";
    } else {
      const subscriptionEnd = subscriptionDoc.subscriptionEndDate
        ? new Date(subscriptionDoc.subscriptionEndDate).getTime()
        : null;
      nextStatus =
        subscriptionEnd && subscriptionEnd < now ? "expired" : "active";
    }
  }

  if (subscriptionDoc.subscriptionStatus !== nextStatus) {
    subscriptionDoc.subscriptionStatus = nextStatus;
    await subscriptionDoc.save();
  }

  return subscriptionDoc;
};

const getOrganizationSubscriptionDoc = async (organizationId) => {
  const subscription = await OrganizationSubscription.findOne({
    organizationId,
  }).lean(false);

  return refreshSubscriptionStatus(subscription);
};

const serializeSubscription = async (organizationId, subscriptionDoc) => {
  const subscription = await refreshSubscriptionStatus(subscriptionDoc);
  const branchUsage = await getOrganizationBranchCount(organizationId);

  if (!subscription) {
    return {
      hasSubscription: false,
      planId: null,
      planType: null,
      status: "expired",
      subscriptionStatus: "expired",
      billingCycle: null,
      startDate: null,
      expiryDate: null,
      trialStartDate: null,
      trialEndDate: null,
      subscriptionStartDate: null,
      subscriptionEndDate: null,
      paymentStatus: "pending",
      activePlan: null,
      branchUsage,
      branchLimit: null,
      branchUsageLabel: `${branchUsage}/0 used`,
      canAddBranch: false,
      restrictionReason: "No active subscription. Please choose a plan.",
      expiryWarning: false,
      hasDashboardAccess: false,
      isTrialPlan: false,
    };
  }

  const branchLimit = subscription.planSnapshot?.branchLimit ?? null;
  const isTrialPlan = subscription.subscriptionStatus === "trial";
  const relevantEndDate = isTrialPlan
    ? subscription.trialEndDate
    : subscription.subscriptionEndDate;
  const expiresInMs = relevantEndDate
    ? new Date(relevantEndDate).getTime() - Date.now()
    : Number.POSITIVE_INFINITY;
  const expiryWarning =
    DASHBOARD_ALLOWED_STATUSES.has(subscription.subscriptionStatus) &&
    expiresInMs <= FIVE_DAYS_IN_MS;
  const branchLimitReached =
    branchLimit !== null && Number(branchUsage) >= Number(branchLimit);
  const hasDashboardAccess = DASHBOARD_ALLOWED_STATUSES.has(
    subscription.subscriptionStatus,
  );

  return {
    hasSubscription: true,
    planId: subscription.planId,
    planType: subscription.billingCycle,
    status: subscription.subscriptionStatus,
    subscriptionStatus: subscription.subscriptionStatus,
    billingCycle: subscription.billingCycle,
    startDate:
      subscription.subscriptionStartDate || subscription.trialStartDate || null,
    expiryDate:
      subscription.subscriptionEndDate || subscription.trialEndDate || null,
    trialStartDate: subscription.trialStartDate,
    trialEndDate: subscription.trialEndDate,
    subscriptionStartDate: subscription.subscriptionStartDate,
    subscriptionEndDate: subscription.subscriptionEndDate,
    paymentStatus: subscription.paymentStatus,
    activePlan: {
      planId: subscription.planId,
      ...subscription.planSnapshot,
      isFreeTrialPlan:
        Number(subscription.planSnapshot?.monthlyPrice || 0) === 0 &&
        Number(subscription.planSnapshot?.yearlyPrice || 0) === 0,
    },
    branchUsage,
    branchLimit,
    branchUsageLabel:
      branchLimit === null
        ? `${branchUsage}/Unlimited used`
        : `${branchUsage}/${branchLimit} used`,
    canAddBranch: hasDashboardAccess && !branchLimitReached,
    restrictionReason: resolveRestrictionReason({
      status: subscription.subscriptionStatus,
      branchLimitReached,
      isTrialPlan,
    }),
    expiryWarning,
    hasDashboardAccess,
    isTrialPlan,
  };
};

exports.listPlans = async (user) => {
  const filter = user?.role === "SUPER_ADMIN" ? {} : { isActive: true };
  const plans = await SubscriptionPlan.find(filter).sort({
    monthlyPrice: 1,
    createdAt: 1,
  });

  return plans.map(serializePlan);
};

exports.listPublicPlans = async () => {
  const plans = await SubscriptionPlan.find({ isActive: true }).sort({
    monthlyPrice: 1,
    createdAt: 1,
  });

  return plans.map((plan, index) =>
    serializePublicPlan(plan, index, plans.length),
  );
};

exports.createPlan = async (payload) => {
  const sanitized = sanitizePlanPayload(payload);
  const existing = await SubscriptionPlan.findOne({ name: sanitized.name });

  if (existing) {
    throw new Error("A plan with this name already exists");
  }

  const plan = await SubscriptionPlan.create(sanitized);
  return serializePlan(plan);
};

exports.updatePlan = async (planId, payload) => {
  const plan = await SubscriptionPlan.findById(planId);

  if (!plan) {
    throw new Error("Plan not found");
  }

  const sanitized = sanitizePlanPayload({
    ...plan.toObject(),
    ...payload,
    isActive:
      typeof payload.isActive === "boolean" ? payload.isActive : plan.isActive,
  });

  const duplicate = await SubscriptionPlan.findOne({
    _id: { $ne: planId },
    name: sanitized.name,
  });

  if (duplicate) {
    throw new Error("A plan with this name already exists");
  }

  if (sanitized.branchLimit !== null) {
    const subscriptions = await OrganizationSubscription.find({
      planId,
      subscriptionStatus: { $in: ["active", "trial"] },
    }).select("organizationId");

    for (const subscription of subscriptions) {
      const branchCount = await getOrganizationBranchCount(
        subscription.organizationId,
      );

      if (branchCount > sanitized.branchLimit) {
        throw new Error(
          `Cannot reduce branch limit below current usage for organization ${subscription.organizationId}`,
        );
      }
    }
  }

  Object.assign(plan, sanitized);
  await plan.save();

  await OrganizationSubscription.updateMany(
    { planId },
    {
      $set: {
        planSnapshot: buildPlanSnapshot(plan),
      },
    },
  );

  return serializePlan(plan);
};

exports.deletePlan = async (planId) => {
  const plan = await SubscriptionPlan.findById(planId);

  if (!plan) {
    throw new Error("Plan not found");
  }

  await plan.deleteOne();
  return { message: "Plan deleted successfully" };
};

exports.assignPlanToOrganization = async ({
  organizationId,
  planId,
  billingCycle,
  assignedBy,
  payment = null,
  startDate = new Date(),
  allowAnyPlanSelectionWhenInactive = false,
}) => {
  const plan = await SubscriptionPlan.findById(planId);

  if (!plan) {
    throw new Error("Selected plan no longer exists");
  }

  const organization = await Organization.findOne({
    organizationId,
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  if (!["monthly", "yearly"].includes(billingCycle)) {
    throw new Error("Billing cycle must be monthly or yearly");
  }

  await assertUpgradeOnlySelection({
    organizationId,
    selectedPlan: plan,
    allowAnyPlanSelectionWhenInactive,
  });

  const currentBranchCount = await getOrganizationBranchCount(organizationId);

  if (plan.branchLimit !== null && currentBranchCount > plan.branchLimit) {
    throw new Error(
      "Cannot assign this plan because current branch usage exceeds its limit",
    );
  }

  const effectiveStart = new Date(startDate);
  const isTrial = isFreePlan(plan, billingCycle);
  const subscriptionEndDate = isTrial
    ? null
    : addBillingCycle(effectiveStart, billingCycle);
  const trialEndDate = isTrial ? addTrialPeriod(effectiveStart) : null;
  const nextStatus = isTrial
    ? "trial"
    : subscriptionEndDate.getTime() < Date.now()
      ? "expired"
      : "active";

  const subscription = await OrganizationSubscription.findOneAndUpdate(
    { organizationId },
    {
      organizationId,
      planId: plan._id,
      billingCycle,
      trialStartDate: isTrial ? effectiveStart : null,
      trialEndDate,
      subscriptionStartDate: isTrial ? null : effectiveStart,
      subscriptionEndDate,
      subscriptionStatus: nextStatus,
      paymentStatus: isTrial ? "not_required" : "success",
      planSnapshot: buildPlanSnapshot(plan),
      payment: payment || { provider: isTrial ? "free" : "manual" },
      assignedBy: assignedBy || null,
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  await recordSubscriptionPayment({
    organizationId,
    plan,
    billingCycle,
    payment,
    assignedBy,
    paymentDate: effectiveStart,
    status: isTrial ? "success" : "success",
  });

  return serializeSubscription(organizationId, subscription);
};

exports.cancelOrganizationSubscription = async ({
  organizationId,
  assignedBy,
}) => {
  const organization = await Organization.findOne({ organizationId }).lean();

  if (!organization) {
    throw new Error("Organization not found");
  }

  const subscription = await OrganizationSubscription.findOne({ organizationId });

  if (!subscription) {
    throw new Error("No subscription found for this organization");
  }

  const now = new Date();

  subscription.subscriptionStatus = "cancelled";
  subscription.subscriptionEndDate = subscription.subscriptionEndDate || now;
  subscription.trialEndDate = subscription.trialEndDate || now;
  subscription.assignedBy = assignedBy || subscription.assignedBy || null;

  await subscription.save();

  return serializeSubscription(organizationId, subscription);
};

exports.getSubscriptionAccessForOrganization = async (organizationId) => {
  const subscription = await getOrganizationSubscriptionDoc(organizationId);
  return serializeSubscription(organizationId, subscription);
};

exports.assertCanCreateBranch = async (organizationId) => {
  const summary =
    await exports.getSubscriptionAccessForOrganization(organizationId);

  if (!summary.hasDashboardAccess) {
    throw new Error(
      summary.restrictionReason ||
        "Your subscription is inactive. Please renew or upgrade.",
    );
  }

  if (!summary.canAddBranch) {
    throw new Error(summary.restrictionReason);
  }

  return summary;
};

exports.getBranchEligibility = async (user, organizationIdOverride = null) => {
  let organizationId = organizationIdOverride;

  if (user.role === "CORPORATE_ADMIN") {
    organizationId = user.organizationId;
  }

  if (!organizationId) {
    throw new Error("Organization is required");
  }

  const organization = await Organization.findOne({ organizationId }).lean();

  if (!organization) {
    throw new Error("Organization not found");
  }

  return {
    organizationId,
    organizationName: organization.name,
    ...(await exports.getSubscriptionAccessForOrganization(organizationId)),
  };
};

exports.getOrganizationSubscriptionDetails = async (user, organizationId) => {
  const organization = await assertOrganizationAccess(user, organizationId);
  const contact = await resolveOrganizationContact(organizationId);
  const [subscriptionDoc, payments, branchCount] = await Promise.all([
    getOrganizationSubscriptionDoc(organizationId),
    SubscriptionPayment.find({ organizationId })
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean(),
    getOrganizationBranchCount(organizationId),
  ]);

  const subscription = await serializeSubscription(organizationId, subscriptionDoc);
  const totalPaid = payments
    .filter((payment) => payment.status === "success")
    .reduce(
      (sum, payment) => sum + Number(payment.amount || 0) + Number(payment.taxAmount || 0),
      0,
    );

  const serializedPayments = payments.map((payment) => ({
    _id: payment._id,
    invoiceId: payment.invoiceId || null,
    date: payment.paymentDate,
    amount: Number(payment.amount || 0) + Number(payment.taxAmount || 0),
    subtotal: Number(payment.amount || 0),
    taxAmount: Number(payment.taxAmount || 0),
    paymentMethod: payment.provider || "manual",
    status:
      payment.status === "success"
        ? "paid"
        : payment.status === "failed"
          ? "failed"
          : "pending",
    billingCycle: payment.billingCycle,
    paymentId: payment.paymentId || null,
    orderId: payment.orderId || null,
    hasInvoice: Boolean(payment.invoicePdfPath),
    billingPeriodStart: payment.billingPeriodStart,
    billingPeriodEnd: payment.billingPeriodEnd,
  }));

  return {
    organization: {
      _id: organization._id,
      organizationId: organization.organizationId,
      name: organization.name,
      email: contact.email,
      phone: contact.phone || organization.contactPhone || "",
      address: buildAddress(organization),
      totalBranches: branchCount,
      createdDate: organization.createdAt,
      currency: organization.currency,
      status: subscription.subscriptionStatus,
    },
    subscription: {
      planName: subscription.activePlan?.name || "No Active Plan",
      planType: subscription.billingCycle,
      price:
        subscription.activePlan && subscription.billingCycle
          ? getPlanAmount(subscription.activePlan, subscription.billingCycle)
          : 0,
      startDate: subscription.startDate,
      expiryDate: subscription.expiryDate,
      autoRenewal: false,
      status: subscription.subscriptionStatus,
      branchUsage: subscription.branchUsage,
      branchLimit: subscription.branchLimit,
    },
    kpis: {
      activePlan: subscription.activePlan?.name || "No Active Plan",
      billingCycle: subscription.billingCycle ? capitalize(subscription.billingCycle) : "-",
      branchUsage:
        subscription.branchLimit === null
          ? `${subscription.branchUsage} / Unlimited`
          : `${subscription.branchUsage} / ${subscription.branchLimit || 0}`,
      nextBillingDate: formatDate(subscription.expiryDate),
      totalPaid,
      status: subscription.subscriptionStatus,
    },
    payments: serializedPayments,
  };
};

exports.generateSubscriptionInvoice = async ({
  user,
  organizationId,
  paymentId = null,
}) => {
  const organization = await assertOrganizationAccess(user, organizationId);
  const paymentQuery = {
    organizationId,
    ...(paymentId ? { _id: paymentId } : {}),
  };

  const payment = await SubscriptionPayment.findOne(paymentQuery).sort({
    paymentDate: -1,
    createdAt: -1,
  });

  if (!payment) {
    throw new Error("Subscription payment not found");
  }

  const subscriptionDoc = await getOrganizationSubscriptionDoc(organizationId);
  const subscription = await serializeSubscription(organizationId, subscriptionDoc);
  const contact = await resolveOrganizationContact(organizationId);
  const settings = await getSystemSettings();
  const currencyCode = organization.currency || settings.baseCurrency || DEFAULT_CURRENCY;

  if (!payment.invoiceId) {
    payment.invoiceId = `SUB-${uuidv4().split("-")[0].toUpperCase()}`;
  }

  const pdfPath = await generateSubscriptionInvoicePdf({
    organization: {
      ...organization,
      contactEmail: contact.email,
      contactPhone: contact.phone || organization.contactPhone || "",
    },
    subscription,
    payment,
    currencyCode,
  });

  payment.invoicePdfPath = pdfPath;
  await payment.save();

  return {
    invoiceId: payment.invoiceId,
    paymentId: payment._id,
    pdfUrl: `/api/invoices/${payment.invoiceId}/pdf?download=1`,
  };
};

exports.getSubscriptionInvoiceByInvoiceId = async (user, invoiceId) => {
  const payment = await SubscriptionPayment.findOne({ invoiceId }).lean();

  if (!payment) {
    throw new Error("Invoice not found");
  }

  const organization = await assertOrganizationAccess(user, payment.organizationId);
  const subscriptionDoc = await getOrganizationSubscriptionDoc(payment.organizationId);
  const subscription = await serializeSubscription(payment.organizationId, subscriptionDoc);
  const contact = await resolveOrganizationContact(payment.organizationId);
  const settings = await getSystemSettings();
  const currencyCode = organization.currency || settings.baseCurrency || DEFAULT_CURRENCY;

  return {
    invoiceId: payment.invoiceId,
    organizationId: payment.organizationId,
    organizationName: organization.name,
    amount: Number(payment.amount || 0) + Number(payment.taxAmount || 0),
    subtotal: Number(payment.amount || 0),
    taxAmount: Number(payment.taxAmount || 0),
    paymentDate: payment.paymentDate,
    billingPeriodStart: payment.billingPeriodStart,
    billingPeriodEnd: payment.billingPeriodEnd,
    status:
      payment.status === "success"
        ? "paid"
        : payment.status === "failed"
          ? "failed"
          : "pending",
    paymentMethod: payment.provider || "manual",
    hasPdf: Boolean(payment.invoicePdfPath),
    pdfUrl: `/api/invoices/${payment.invoiceId}/pdf`,
    organization: {
      name: organization.name,
      email: contact.email,
      phone: contact.phone || organization.contactPhone || "",
      address: buildAddress(organization),
    },
    subscription: {
      planName: subscription.activePlan?.name || "-",
      billingCycle: capitalize(payment.billingCycle),
    },
    currencyCode,
    formattedAmount: formatCurrency(
      Number(payment.amount || 0) + Number(payment.taxAmount || 0),
      currencyCode,
    ),
  };
};

exports.getSubscriptionInvoicePdfPath = async (user, invoiceId) => {
  const payment = await SubscriptionPayment.findOne({ invoiceId });

  if (!payment) {
    throw new Error("Invoice not found");
  }

  await assertOrganizationAccess(user, payment.organizationId);

  if (payment.invoicePdfPath && fs.existsSync(payment.invoicePdfPath)) {
    return {
      filePath: payment.invoicePdfPath,
      invoiceId: payment.invoiceId,
    };
  }

  await exports.generateSubscriptionInvoice({
    user,
    organizationId: payment.organizationId,
    paymentId: payment._id,
  });

  const refreshedPayment = await SubscriptionPayment.findOne({ invoiceId }).lean();

  if (!refreshedPayment?.invoicePdfPath || !fs.existsSync(refreshedPayment.invoicePdfPath)) {
    throw new Error("Invoice PDF could not be generated");
  }

  return {
    filePath: refreshedPayment.invoicePdfPath,
    invoiceId: refreshedPayment.invoiceId,
  };
};

exports.listOrganizationSubscriptions = async (user) => {
  const filter =
    user.role === "SUPER_ADMIN"
      ? {}
      : {
          organizationId: user.organizationId,
        };

  const organizations = await Organization.find(filter)
    .sort({ createdAt: -1 })
    .lean();

  const result = [];

  for (const organization of organizations) {
    const subscriptionDoc = await getOrganizationSubscriptionDoc(
      organization.organizationId,
    );
    const subscription = await serializeSubscription(
      organization.organizationId,
      subscriptionDoc,
    );

    result.push({
      _id: organization._id,
      organizationId: organization.organizationId,
      organizationName: organization.name,
      activePlan: subscription.activePlan?.name || "No Active Plan",
      planType: subscription.billingCycle
        ? subscription.billingCycle === "yearly"
          ? "Yearly"
          : "Monthly"
        : subscription.subscriptionStatus === "trial"
          ? "Trial"
          : "-",
      branchUsage: !subscription.hasSubscription
        ? `${subscription.branchUsage} / 0`
        : subscription.branchLimit === null
          ? `${subscription.branchUsage} / Unlimited`
          : `${subscription.branchUsage} / ${subscription.branchLimit}`,
      branchUsageCount: subscription.branchUsage,
      branchLimit: subscription.branchLimit,
      expiryDate: subscription.expiryDate,
      status: subscription.subscriptionStatus,
      canAddBranch: subscription.canAddBranch,
      restrictionReason: subscription.restrictionReason,
      features: subscription.activePlan?.features || [],
      description: subscription.activePlan?.description || "",
      subscription,
    });
  }

  return result;
};

exports.getDashboardData = async (user) => {
  const [plans, organizations, branches] = await Promise.all([
    exports.listPlans(user),
    exports.listOrganizationSubscriptions(user),
    user.role === "SUPER_ADMIN"
      ? Branch.find().sort({ createdAt: -1 }).lean()
      : Branch.find({ organizationId: user.organizationId })
          .sort({ createdAt: -1 })
          .lean(),
  ]);

  const currentOrganization =
    user.role === "CORPORATE_ADMIN" ? organizations[0] || null : null;

  const banners = [];

  if (currentOrganization?.subscription?.expiryWarning) {
    banners.push({
      type: "warning",
      message:
        currentOrganization.subscription.subscriptionStatus === "trial"
          ? "Your trial will expire soon. Please upgrade your subscription."
          : "Your subscription will expire soon. Please renew your plan.",
    });
  }

  if (
    currentOrganization?.subscription?.restrictionReason &&
    !currentOrganization.subscription.hasDashboardAccess
  ) {
    banners.push({
      type: "danger",
      message: currentOrganization.subscription.restrictionReason,
    });
  } else if (
    currentOrganization?.subscription?.restrictionReason ===
    "Branch limit reached. Upgrade your plan."
  ) {
    banners.push({
      type: "warning",
      message: currentOrganization.subscription.restrictionReason,
    });
  }

  return {
    plans,
    organizations,
    branches,
    currentOrganization,
    banners,
  };
};

exports.createRazorpayOrder = async (user, { planId, billingCycle }) => {
  if (!user || !user.organizationId) {
    throw new Error("User organizationId missing. Please login again.");
  }

  if (!["CORPORATE_ADMIN", "SUPER_ADMIN"].includes(user.role)) {
    throw new Error("Unauthorized");
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay is not configured");
  }

  const plan = await SubscriptionPlan.findById(planId);

  if (!plan || !plan.isActive) {
    throw new Error("Selected plan is unavailable");
  }

  if (!["monthly", "yearly"].includes(billingCycle)) {
    throw new Error("Billing cycle must be monthly or yearly");
  }

  await assertUpgradeOnlySelection({
    organizationId: user.organizationId,
    selectedPlan: plan,
    allowAnyPlanSelectionWhenInactive: true,
  });

  const currentBranchCount = await getOrganizationBranchCount(
    user.organizationId,
  );

  if (plan.branchLimit !== null && currentBranchCount > plan.branchLimit) {
    throw new Error(
      "Cannot downgrade to this plan because your organization uses more branches than allowed",
    );
  }

  const amount = getPlanAmount(plan, billingCycle);

  if (amount === 0) {
    return {
      directActivation: true,
      subscription: await exports.assignPlanToOrganization({
        organizationId: user.organizationId,
        planId,
        billingCycle,
        assignedBy: user._id,
        payment: { provider: "free" },
        allowAnyPlanSelectionWhenInactive: true,
      }),
      plan: serializePlan(plan),
      billingCycle,
      amount,
      organizationId: user.organizationId,
    };
  }

  const order = await razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency: process.env.RAZORPAY_CURRENCY || "INR",
    receipt: `rcpt_${user._id}_${Date.now()}`.slice(0, 40),
    notes: {
      organizationId: user.organizationId,
      planId: String(plan._id),
      billingCycle,
    },
  });

  return {
    key: process.env.RAZORPAY_KEY_ID,
    order,
    plan: serializePlan(plan),
    billingCycle,
    amount,
    organizationId: user.organizationId,
  };
};

exports.verifyRazorpayPayment = async (
  user,
  {
    planId,
    billingCycle,
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  },
) => {
  if (user.role !== "CORPORATE_ADMIN") {
    throw new Error("Only corporate admins can verify subscription payments");
  }

  if (
    !planId ||
    !billingCycle ||
    !razorpay_order_id ||
    !razorpay_payment_id ||
    !razorpay_signature
  ) {
    throw new Error("Incomplete payment verification payload");
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    throw new Error("Payment signature verification failed");
  }

  return exports.assignPlanToOrganization({
    organizationId: user.organizationId,
    planId,
    billingCycle,
    assignedBy: user._id,
    payment: {
      provider: "razorpay",
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    },
    allowAnyPlanSelectionWhenInactive: true,
  });
};

exports.getPlanById = async (planId) => {
  if (!planId) {
    throw new Error("PlanId is required");
  }

  const plan = await SubscriptionPlan.findById(planId);

  if (!plan || !plan.isActive) {
    throw new Error("The selected plan is no longer available");
  }

  return plan;
};

exports.getSerializedPlanById = async (planId) => {
  const plan = await exports.getPlanById(planId);
  return serializePlan(plan);
};

exports.getPlanAmount = getPlanAmount;
exports.isFreePlan = isFreePlan;
exports.buildPlanSnapshot = buildPlanSnapshot;
exports.recordSubscriptionPayment = recordSubscriptionPayment;
exports.addTrialPeriod = addTrialPeriod;
exports.addBillingCycle = addBillingCycle;
