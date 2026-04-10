const crypto = require("crypto");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const Organization = require("./organization.model");
const User = require("../user/user.model");
const SubscriptionPlan = require("../subscription/subscriptionPlan.model");
const OrganizationSubscription = require("../subscription/organizationSubscription.model");
const SubscriptionPayment = require("../subscription/subscriptionPayment.model");
const subscriptionService = require("../subscription/subscription.service");
const { sendCorporateAdminInvite } = require("../../utils/sendEmail");
const USER_INVITE_EXPIRY_MS = 10 * 60 * 1000;

const normalizePlanCode = (value) =>
  (
    {
      FREE: "STARTER",
      TRIAL: "STARTER",
      BASIC: "STARTER",
      STARTER: "STARTER",
      PRO: "PROFESSIONAL",
      PROFESSIONAL: "PROFESSIONAL",
      ENTERPRISE: "ENTERPRISE",
    }[String(value || "").trim().toUpperCase()] || "STARTER"
  );

/*
  Create Organization + Corporate Admin Invite Flow
*/
exports.createOrganization = async (data, superAdminId) => {
  if (!superAdminId) {
    throw new Error("Super Admin ID is required");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      name,
      systemIdentifier,
      headquartersAddress,
      currency,
      timezone,
      planId,
      billingCycle,
      corporateAdmin,
    } = data;

    if (
      !name ||
      !systemIdentifier ||
      !headquartersAddress ||
      !currency ||
      !timezone ||
      !planId ||
      !billingCycle ||
      !corporateAdmin ||
      !corporateAdmin.name ||
      !corporateAdmin.email
    ) {
      throw new Error("All required fields must be provided");
    }

    if (!["monthly", "yearly"].includes(String(billingCycle))) {
      throw new Error("Billing cycle must be monthly or yearly");
    }

    const existingOrg = await Organization.findOne({
      systemIdentifier: systemIdentifier.toUpperCase(),
    }).session(session);

    if (existingOrg) {
      throw new Error("Organization already exists");
    }

    const plan = await SubscriptionPlan.findById(planId).session(session);

    if (!plan || !plan.isActive) {
      throw new Error("Selected subscription plan is invalid");
    }

    const orgUUID = uuidv4();

    const organization = new Organization({
      organizationId: orgUUID,
      name,
      systemIdentifier: systemIdentifier.toUpperCase(),
      headquartersAddress,
      serviceTier: normalizePlanCode(plan.name),
      currency,
      timezone,
      createdBy: superAdminId,
    });

    await organization.save({ session });

    const inviteToken = crypto.randomBytes(32).toString("hex");

    await User.create(
      [
        {
          organizationId: organization.organizationId,
          branchId: null,
          role: "CORPORATE_ADMIN",
          isPlatformAdmin: false,
          name: corporateAdmin.name,
          email: corporateAdmin.email,
          phone: corporateAdmin.phone || null,
          password: "TEMP_PASSWORD",
          isActive: false,
          inviteToken,
          inviteExpiresAt: new Date(Date.now() + USER_INVITE_EXPIRY_MS),
          createdBy: superAdminId,
        },
      ],
      { session },
    );

    const now = new Date();
    const isTrialPlan = subscriptionService.isFreePlan(plan, billingCycle);
    const trialEndDate = isTrialPlan
      ? subscriptionService.addTrialPeriod(now)
      : null;
    const subscriptionEndDate = isTrialPlan
      ? null
      : subscriptionService.addBillingCycle(now, billingCycle);

    await OrganizationSubscription.create(
      [
        {
          organizationId: organization.organizationId,
          planId: plan._id,
          billingCycle,
          trialStartDate: isTrialPlan ? now : null,
          trialEndDate,
          subscriptionStartDate: isTrialPlan ? null : now,
          subscriptionEndDate,
          subscriptionStatus: isTrialPlan ? "trial" : "active",
          paymentStatus: isTrialPlan ? "not_required" : "success",
          planSnapshot: subscriptionService.buildPlanSnapshot(plan),
          payment: { provider: isTrialPlan ? "free" : "manual" },
          assignedBy: superAdminId,
        },
      ],
      { session },
    );

    await SubscriptionPayment.create(
      [
        {
          organizationId: organization.organizationId,
          planId: plan._id,
          billingCycle,
          amount: subscriptionService.getPlanAmount(plan, billingCycle),
          status: "success",
          paymentDate: now,
          provider: isTrialPlan ? "free" : "manual",
          assignedBy: superAdminId,
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    const baseUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");
    const inviteLink = `${baseUrl}/accept-invite?token=${inviteToken}`;

    try {
      await sendCorporateAdminInvite(
        corporateAdmin.email,
        corporateAdmin.name,
        inviteLink,
        organization.name,
      );
    } catch (emailError) {
      console.error("Failed to send invite email:", emailError.message);
    }

    return {
      organization,
      subscription: {
        planId: plan._id,
        planName: plan.name,
        billingCycle,
      },
      message: "Organization created and Corporate Admin invited",
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    throw error;
  }
};

/*
  Get All Organizations (Super Admin only)
*/
exports.getAllOrganizations = async () => {
  return await Organization.find().sort({ createdAt: -1 });
};

/*
  Deactivate Organization
*/
exports.deactivateOrganization = async (organizationId) => {
  const organization = await Organization.findOneAndUpdate(
    { organizationId },
    { isActive: false },
    { new: true },
  );

  if (!organization) {
    throw new Error("Organization not found");
  }

  return organization;
};
