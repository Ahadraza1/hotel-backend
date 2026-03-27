const Organization = require("./organization.model");
const User = require("../user/user.model");
const crypto = require("crypto");
const mongoose = require("mongoose");

const { sendCorporateAdminInvite } = require("../../utils/sendEmail");

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
      serviceTier,
      currency,
      timezone,
      corporateAdmin,
    } = data;

    if (
      !name ||
      !systemIdentifier ||
      !headquartersAddress ||
      !currency ||
      !timezone ||
      !corporateAdmin ||
      !corporateAdmin.name ||
      !corporateAdmin.email
    ) {
      throw new Error("All required fields must be provided");
    }

    const existingOrg = await Organization.findOne({
      systemIdentifier: systemIdentifier.toUpperCase(),
    });

    if (existingOrg) {
      throw new Error("Organization already exists");
    }

    /*
      1️⃣ Create Organization
    */
    const { v4: uuidv4 } = require("uuid");

    const orgUUID = uuidv4();

    const organization = new Organization({
      organizationId: orgUUID,
      name,
      systemIdentifier: systemIdentifier.toUpperCase(),
      headquartersAddress,
      serviceTier,
      currency,
      timezone,
      createdBy: superAdminId,
    });

    await organization.save({ session });

    /*
      2️⃣ Generate Invite Token
    */
    const inviteToken = crypto.randomBytes(32).toString("hex");

    /*
      3️⃣ Create Corporate Admin (Inactive)
    */
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
          inviteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          createdBy: superAdminId,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    const baseUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");
    const inviteLink = `${baseUrl}/accept-invite?token=${inviteToken}`;

    console.log("=====================================");
    console.log("📩 CORPORATE ADMIN INVITE TOKEN:");
    console.log(inviteToken);
    console.log("📩 CORPORATE ADMIN INVITE LINK:");
    console.log(inviteLink);
    console.log("=====================================");

    /*
      4️⃣ Send Invitation Email
    */
    try {
      await sendCorporateAdminInvite(
        corporateAdmin.email,
        corporateAdmin.name,
        inviteLink,
        organization.name
      );

      console.log("📧 Corporate Admin invitation email sent");
    } catch (emailError) {
      console.error("❌ Failed to send invite email:", emailError.message);
    }

    return {
      organization,
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
    { new: true }
  );

  if (!organization) {
    throw new Error("Organization not found");
  }

  return organization;
};
