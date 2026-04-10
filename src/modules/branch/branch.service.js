const Branch = require("./branch.model");
const User = require("../user/user.model");
const Room = require("../room/room.model");
const crypto = require("crypto");
const Organization = require("../organization/organization.model");
const Invitation = require("../invitation/invitation.model");
const { sendEmail } = require("../../utils/sendEmail");
const mongoose = require("mongoose");
const subscriptionService = require("../subscription/subscription.service");

const getBranchManagerRecord = async (branch) => {
  const branchId = branch._id.toString();

  const managerUser = await User.findOne({
    branchId,
    role: "BRANCH_MANAGER",
    isDeleted: { $ne: true },
  })
    .select("_id name email phone")
    .lean();

  if (managerUser) {
    return {
      source: "user",
      _id: managerUser._id,
      name: managerUser.name || "",
      email: managerUser.email || "",
      phone: managerUser.phone || "",
    };
  }

  const pendingInvitation = await Invitation.findOne({
    branchId,
    role: "BRANCH_MANAGER",
    status: "pending",
  })
    .sort({ createdAt: -1 })
    .select("_id name email")
    .lean();

  if (pendingInvitation) {
    return {
      source: "invitation",
      _id: pendingInvitation._id,
      name: pendingInvitation.name || "",
      email: pendingInvitation.email || "",
      phone: "",
    };
  }

  return null;
};

/*
  Create Branch + Invite Manager
*/
exports.createBranch = async (data, user) => {
  if (!user || !user._id) {
    throw new Error("Unauthorized: User not found");
  }

  const {
    organizationId,
    name,
    country,
    state,
    city,
    status,
    address,
    taxNumber,
    currency,
    timezone,
    contactNumber,
    rooms,
    floors,
    manager,
    salary,
  } = data;

  if (!name || !currency || !timezone || !country || !status) {
    throw new Error("Required branch fields are missing");
  }

  if (!manager || !manager.name || !manager.email || !manager.phone) {
    throw new Error("Branch manager details are required");
  }

  let finalOrganizationId;

  const role = user.role?.toUpperCase();

  if (role === "SUPER_ADMIN") {
    if (!organizationId) {
      throw new Error("OrganizationId is required for Super Admin");
    }
    finalOrganizationId = organizationId;
  } else if (role === "CORPORATE_ADMIN") {
    finalOrganizationId = user.organizationId;
  } else {
    throw new Error(`Access denied for role: ${user.role}`);
  }

  await subscriptionService.assertCanCreateBranch(finalOrganizationId);

  // Prevent duplicate user
  const existingUser = await User.findOne({ email: manager.email });

  if (existingUser) {
    throw new Error("Manager email already exists");
  }

  /*
    CREATE BRANCH
  */
  const branch = await Branch.create({
    organizationId: finalOrganizationId,
    name,
    country,
    state,
    city,
    status,
    address,
    taxNumber,
    currency,
    timezone,
    contactNumber,
    totalRooms: rooms || 0,
    floors: floors || 1,
    floor: floors || 1, // ✅ add this line
    createdBy: user._id,
  });

  /*
  🔥 AUTO GENERATE ROOMS
*/
  /*
  🔥 FLOOR BASED ROOM GENERATION
*/
  /*
  🔥 FLOOR BASED ROOM GENERATION
*/
  if (rooms && rooms > 0) {
    const totalFloors = floors || 1;
    const roomsPerFloor = Math.ceil(rooms / totalFloors);

    const generatedRooms = [];

    for (let floor = 1; floor <= totalFloors; floor++) {
      for (let r = 1; r <= roomsPerFloor; r++) {
        const roomNumber = String(floor * 100 + r);

        generatedRooms.push({
          branchId: branch._id,
          organizationId: finalOrganizationId,
          roomNumber,
          floor: floor,
          roomType: "STANDARD",
          pricePerNight: 0,
          status: "AVAILABLE",
          createdBy: user._id,
        });

        if (generatedRooms.length === rooms) break;
      }

      if (generatedRooms.length === rooms) break;
    }

    await Room.insertMany(generatedRooms);

    console.log(
      `🏨 ${generatedRooms.length} rooms created for branch ${branch.name}`,
    );
  }

  /*
    GENERATE INVITATION
  */
  const token = crypto.randomBytes(32).toString("hex");

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await Invitation.create({
    name: manager.name,
    email: manager.email,
    role: "BRANCH_MANAGER",
    organizationId: finalOrganizationId,
    branchId: branch._id,
    invitedBy: user._id,
    salary: salary || 0,
    token,
    expiresAt,
  });

  /*
  GET ORGANIZATION NAME
*/
let organization = null;

if (mongoose.Types.ObjectId.isValid(finalOrganizationId)) {
  organization = await Organization.findById(finalOrganizationId);
} else {
  organization = await Organization.findOne({
    organizationId: finalOrganizationId,
  });
}
  /*
    INVITE LINK
  */
  const baseUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");

  const inviteLink = `${baseUrl}/accept-invite?token=${token}&email=${manager.email}`;

  /*
    EMAIL TEMPLATE
  */
  const html = `
    <h2>You're invited to join Luxury HMS</h2>

    <p>Hello <b>${manager.name}</b>,</p>

    <p>You have been invited as <b>Branch Manager</b>.</p>

    <p><b>Organization:</b> ${organization?.name}</p>
    <p><b>Branch:</b> ${branch.name}</p>

    <p>This invitation will expire in 10 minutes.</p>

    <a href="${inviteLink}"
       style="padding:12px 20px;background:black;color:white;text-decoration:none;border-radius:6px">
       Accept Invitation
    </a>
  `;

  await sendEmail(manager.email, "Branch Manager Invitation", html);

  console.log("📩 Branch Manager Invitation Sent:", manager.email);

  return branch;
};

/*
  Get Branches
*/
exports.getBranches = async (user) => {
  const role = user.role?.toUpperCase();

  let branches;

  if (role === "SUPER_ADMIN") {
    branches = await Branch.find().sort({ createdAt: -1 });
  } else if (role === "CORPORATE_ADMIN") {
    branches = await Branch.find({
      organizationId: user.organizationId,
    }).sort({ createdAt: -1 });
  } else {
    throw new Error("Access denied");
  }

  // 🔥 Fetch all organizations
  const organizations = await Organization.find().lean();

  // 🔥 Create fast lookup map
  const orgMap = new Map(
    organizations.map((org) => [org._id.toString(), org.name]),
  );

  // 🔥 Attach organizationName to each branch
  const enriched = branches.map((branch) => {
    const orgName = orgMap.get(branch.organizationId?.toString());

    return {
      ...branch.toObject(),
      organizationName: orgName || "General",
    };
  });

  return enriched;
};

/*
  Get Single Branch By ID
*/
exports.getBranchById = async (branchId, user) => {
  const branch = await Branch.findById(branchId);

  if (!branch) {
    throw new Error("Branch not found");
  }

  const role = user.role?.toUpperCase();

  /*
  SUPER ADMIN
  */
  if (role === "SUPER_ADMIN") {
    const branchManager = await getBranchManagerRecord(branch);
    return {
      branch,
      branchManager,
    };
  }

  /*
  CORPORATE ADMIN
  */
  if (
    role === "CORPORATE_ADMIN" &&
    branch.organizationId?.toString() === user.organizationId?.toString()
  ) {
    const branchManager = await getBranchManagerRecord(branch);
    return {
      branch,
      branchManager,
    };
  }

  /*
  Branch-level users resolve access through their assigned branch instead of
  a hardcoded role list so new roles inherit the same branch behavior.
  */
  const userBranchId = user.branchId || user.branch || user.branch_id;

  if (
    userBranchId &&
    role !== "SUPER_ADMIN" &&
    role !== "CORPORATE_ADMIN" &&
    userBranchId.toString() === branch._id.toString()
  ) {
    const branchManager = await getBranchManagerRecord(branch);
    return {
      branch,
      branchManager,
    };
  }

  throw new Error("Insufficient permission");
};

/*
  Update Branch
*/
exports.updateBranch = async (branchId, data, user) => {
  const branch = await Branch.findById(branchId);

  if (!branch) {
    throw new Error("Branch not found");
  }

  const canUpdateBranch =
    user.role === "SUPER_ADMIN" ||
    (user.role === "CORPORATE_ADMIN" &&
      branch.organizationId.toString() === user.organizationId?.toString());

  if (!canUpdateBranch) {
    throw new Error("Access denied");
  }

  const { manager, ...branchData } = data;

  const updatedBranch = await Branch.findByIdAndUpdate(branchId, branchData, {
    new: true,
  });

  if (manager && typeof manager === "object") {
    const managerName = String(manager.name || "").trim();
    const managerEmail = String(manager.email || "")
      .trim()
      .toLowerCase();
    const managerPhone = String(manager.phone || "").trim();

    const existingManager = await User.findOne({
      branchId: branch._id.toString(),
      role: "BRANCH_MANAGER",
      isDeleted: { $ne: true },
    });

    if (existingManager) {
      if (
        managerEmail &&
        managerEmail !== existingManager.email &&
        (await User.exists({ email: managerEmail, _id: { $ne: existingManager._id } }))
      ) {
        throw new Error("Manager email already exists");
      }

      existingManager.name = managerName || existingManager.name;
      existingManager.email = managerEmail || existingManager.email;
      existingManager.phone = managerPhone;
      await existingManager.save();
    } else {
      const pendingInvitation = await Invitation.findOne({
        branchId: branch._id.toString(),
        role: "BRANCH_MANAGER",
        status: "pending",
      }).sort({ createdAt: -1 });

      if (pendingInvitation) {
        if (
          managerEmail &&
          managerEmail !== pendingInvitation.email &&
          (await User.exists({ email: managerEmail }))
        ) {
          throw new Error("Manager email already exists");
        }

        pendingInvitation.name = managerName || pendingInvitation.name;
        pendingInvitation.email = managerEmail || pendingInvitation.email;
        await pendingInvitation.save();
      }
    }
  }

  return updatedBranch;

};

/*
  Deactivate Branch (Soft Delete)
*/
exports.deactivateBranch = async (branchId, user) => {
  const branch = await Branch.findById(branchId);

  if (!branch) {
    throw new Error("Branch not found");
  }

  if (user.role === "SUPER_ADMIN") {
    return await Branch.findByIdAndUpdate(
      branchId,
      { isActive: false },
      { new: true },
    );
  }

  if (
    user.role === "CORPORATE_ADMIN" &&
    branch.organizationId.toString() === user.organizationId?.toString()
  ) {
    return await Branch.findByIdAndUpdate(
      branchId,
      { isActive: false },
      { new: true },
    );
  }

  throw new Error("Access denied");
};

/*
  🔥 DELETE Branch (Hard Delete)
*/
exports.deleteBranch = async (branchId, user) => {
  const branch = await Branch.findById(branchId);

  if (!branch) {
    throw new Error("Branch not found");
  }

  if (user.role === "SUPER_ADMIN") {
    return Branch.findByIdAndUpdate(
      branchId,
      {
        isDeleted: true,
        deletedAt: new Date(),
        isActive: false,
      },
      { new: true },
    );
  }

  if (
    user.role === "CORPORATE_ADMIN" &&
    branch.organizationId.toString() === user.organizationId?.toString()
  ) {
    return Branch.findByIdAndUpdate(
      branchId,
      {
        isDeleted: true,
        deletedAt: new Date(),
        isActive: false,
      },
      { new: true },
    );
  }

  throw new Error("Access denied");
};

/*
  Invite Branch Manager
*/
exports.inviteBranchManager = async (data, user) => {
  const { branchId, name, email, phone } = data;

  if (!branchId || !name || !email) {
    throw new Error("Branch, name and email are required");
  }

  const branch = await Branch.findById(branchId);

  if (!branch) {
    throw new Error("Branch not found");
  }

  if (user.role === "CORPORATE_ADMIN") {
    if (branch.organizationId.toString() !== user.organizationId?.toString()) {
      throw new Error("Access denied");
    }
  } else if (user.role !== "SUPER_ADMIN") {
    throw new Error("Access denied");
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new Error("User already exists");
  }

  const USER_INVITE_EXPIRY_MS = 10 * 60 * 1000;
  const inviteToken = crypto.randomBytes(32).toString("hex");

  await User.create({
    organizationId: branch.organizationId,
    branchId: branch._id,
    role: "BRANCH_MANAGER",
    isPlatformAdmin: false,
    name,
    email,
    phone: phone || null,
    password: "TEMP_PASSWORD",
    isActive: false,
    inviteToken,
    inviteExpiresAt: new Date(Date.now() + USER_INVITE_EXPIRY_MS),
  });

  const baseUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");
  const inviteLink = `${baseUrl}/accept-invite?token=${inviteToken}`;

  console.log("📩 Branch Manager Invite Link:");
  console.log(inviteLink);

  return {
    message: "Branch Manager invited successfully",
  };
};
