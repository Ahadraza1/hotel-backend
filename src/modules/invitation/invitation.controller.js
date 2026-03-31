const crypto = require("crypto");
const Invitation = require("./invitation.model");
const User = require("../user/user.model");
const Role = require("../rbac/role.model");
const { sendEmail } = require("../../utils/sendEmail");
const InvitationAudit = require("./invitationAudit.model");
const Organization = require("../organization/organization.model");
const Branch = require("../branch/branch.model");
const {
  ensureActiveBranch,
  ensureActiveOrganization,
} = require("../../utils/workspaceScope");

const normalizeInvitedRole = (role) => {
  const legacyRoleMap = {
    HR: "HR_MANAGER",
    RESTAURANT: "RESTAURANT_MANAGER",
  };

  return legacyRoleMap[role] || role;
};

const getDepartmentFromRole = (role) => {
  const normalizedRole = normalizeInvitedRole(role);

  const roleDepartmentMap = {
    RECEPTIONIST: "FRONT_OFFICE",
    HOUSEKEEPING: "HOUSEKEEPING",
    ACCOUNTANT: "FINANCE",
    HR_MANAGER: "HR",
    RESTAURANT_MANAGER: "RESTAURANT",
    WAITER: "RESTAURANT",
    BRANCH_MANAGER: "MANAGEMENT",
    CHEF: "RESTAURANT",
  };

  return roleDepartmentMap[normalizedRole] || "MANAGEMENT";
};

// Helper: Check role permission
const canInviteRole = (inviterRole, targetRole) => {
  if (inviterRole === "SUPER_ADMIN") return true;

  if (inviterRole === "CORPORATE_ADMIN") {
    if (targetRole === "SUPER_ADMIN") return false;
    return true;
  }

  if (inviterRole === "BRANCH_MANAGER") {
    if (
      ["SUPER_ADMIN", "CORPORATE_ADMIN", "PLATFORM_ADMIN"].includes(targetRole)
    ) {
      return false;
    }
    return true;
  }

  return false;
};

// ================= CREATE INVITE =================
exports.createInvitation = async (req, res) => {
  try {
    const { name, email, role, salary } = req.body;
    const Staff = require("../hr/staff.model");

    if (!name || !email || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const inviter = req.user;

    // 1️⃣ Role Permission Check
    const allowed = canInviteRole(inviter.role, role);

    if (!allowed) {
      return res.status(403).json({
        message: "You are not allowed to invite this role",
      });
    }

    // 2️⃣ Organization & Branch Scope
    let organizationId = inviter.organizationId;
    let branchId = null;

    // 🔥 SUPER_ADMIN → derive organization from branch
    if (inviter.role === "SUPER_ADMIN") {
      if (!req.body.branchId) {
        return res.status(400).json({
          message: "branchId is required for Super Admin",
        });
      }

      const branch = await Branch.findById(req.body.branchId);

      if (!branch) {
        return res.status(404).json({
          message: "Branch not found",
        });
      }
      organizationId = branch.organizationId;
      branchId = branch._id.toString(); // ✅ FIXED
    }

    // 🔥 BRANCH_MANAGER
    if (inviter.role === "BRANCH_MANAGER") {
      branchId = inviter.branchId || req.body.branchId || null;

      if (!branchId) {
        return res.status(400).json({
          message: "branchId is required for Branch Manager invites",
        });
      }
    }

    // 🔥 CORPORATE_ADMIN
    if (inviter.role === "CORPORATE_ADMIN") {
      branchId = req.body.branchId || null;
    }

    if (organizationId && !(await ensureActiveOrganization(organizationId))) {
      return res.status(404).json({
        message: "Organization not found",
      });
    }

    if (branchId && !(await ensureActiveBranch(branchId))) {
      return res.status(404).json({
        message: "Branch not found",
      });
    }

    // Safety check for non-super-admin users
    if (inviter.role !== "SUPER_ADMIN" && !organizationId) {
      return res.status(400).json({
        message: "No organization assigned to this user",
      });
    }

    // 4️⃣ Check if user already exists
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        message: "User with this email already exists",
      });
    }

    // 5️⃣ Generate Secure Token
    const token = crypto.randomBytes(32).toString("hex");

    // 6️⃣ Expiry = 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const invitation = await Invitation.create({
      name,
      email,
      role,
      salary: Number.isFinite(Number(salary)) ? Number(salary) : 0,
      organizationId,
      branchId,
      invitedBy: inviter._id,
      token,
      expiresAt,
    });

    // 🔹 Fetch Organization Name
    const organization = await Organization.findOne({
      organizationId: organizationId,
    });
    //  const organization = await Organization.findById(organizationId);
    // const organization = await Organization.findById(organizationId);

    // 🔹 Fetch Branch Name (if exists)
    let branch = null;
    if (branchId) {
      branch = await Branch.findById(branchId);
      // branch = await Branch.findById(branchId);
    }

    if (branchId) {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedRole = normalizeInvitedRole(role);
      const nameParts = name.trim().split(/\s+/);
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(" ");
      const salaryValue = Number.isFinite(Number(salary)) ? Number(salary) : 0;

      const existingStaff = await Staff.findOne({
        email: normalizedEmail,
        branchId: branchId.toString(),
      });

      if (!existingStaff) {
        await Staff.create({
          organizationId: organizationId?.toString(),
          branchId: branchId.toString(),
          userId: null,
          firstName,
          lastName,
          email: normalizedEmail,
          department: getDepartmentFromRole(role),
          designation: normalizedRole,
          salary: salaryValue,
          joiningDate: req.body.joinedDate || new Date(),
          createdBy: inviter._id,
          isDeleted: false,
        });
      } else {
        existingStaff.organizationId = organizationId?.toString();
        existingStaff.branchId = branchId.toString();
        existingStaff.userId = existingStaff.userId || null;
        existingStaff.firstName = firstName;
        existingStaff.lastName = lastName;
        existingStaff.department = getDepartmentFromRole(role);
        existingStaff.designation = normalizedRole;
        existingStaff.salary = salaryValue;
        existingStaff.isActive = true;
        existingStaff.isDeleted = false;
        existingStaff.deletedAt = null;
        if (!existingStaff.joiningDate) {
          existingStaff.joiningDate = req.body.joinedDate || new Date();
        }
        await existingStaff.save();
      }
    }

    // 7️⃣ Send Email
    const baseUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");
    const inviteLink = `${baseUrl}/accept-invite?token=${token}`;

    const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border-radius:12px;overflow:hidden;
          box-shadow:0 8px 30px rgba(0,0,0,0.05);">

          <!-- Header -->
          <tr>
            <td style="background:#111827;padding:20px;text-align:center;color:#ffffff;">
              <h2 style="margin:0;font-weight:600;">
                ${organization?.name || "Hotel Management System"}
              </h2>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:30px;">
              <h3 style="margin-top:0;color:#111827;">
                You're Invited 🎉
              </h3>

              <p style="color:#4b5563;font-size:14px;">
                Hello <strong>${name}</strong>,
              </p>

              <p style="color:#4b5563;font-size:14px;">
                You have been invited to join:
              </p>

              <!-- Info Card -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#f9fafb;border-radius:8px;padding:15px;margin:20px 0;">
                <tr>
                  <td style="font-size:13px;color:#374151;">
                    <strong>Organization:</strong> ${organization?.name || "-"} <br/>
                    <strong>Branch:</strong> ${branch?.name || "Organization Level"} <br/>
                    <strong>Role:</strong> ${role}
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <div style="text-align:center;margin:30px 0;">
                <a href="${inviteLink}" 
                  style="background:#111827;color:#ffffff;padding:12px 24px;
                  text-decoration:none;border-radius:6px;
                  font-size:14px;font-weight:600;display:inline-block;">
                  Accept Invitation
                </a>
              </div>

              <!-- Expiry -->
              <p style="font-size:12px;color:#dc2626;text-align:center;">
                ⏳ This invitation will expire in 10 minutes.
              </p>

              <!-- Fallback -->
              <p style="font-size:12px;color:#6b7280;margin-top:20px;">
                If the button doesn't work, copy this link:
              </p>
              <p style="font-size:12px;word-break:break-all;color:#2563eb;">
                ${inviteLink}
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:15px;text-align:center;
              font-size:11px;color:#9ca3af;">
              © ${new Date().getFullYear()} ${organization?.name || "Hotel Management System"}.
              All rights reserved.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

    const luxuryHtml = `
<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4efe6; margin: 0; padding: 32px 16px; color: #2d2004;">
  <div style="max-width: 640px; margin: 0 auto; background: #fffdf9; border: 1px solid rgba(176,141,87,0.25); border-radius: 18px; overflow: hidden; box-shadow: 0 24px 60px rgba(32, 22, 4, 0.12);">
    <div style="background: linear-gradient(135deg, #18140d 0%, #2d220f 100%); padding: 32px 40px; border-bottom: 4px solid #b48a2c;">
      <p style="margin: 0 0 8px; color: #e2c98c; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; font-weight: 700;">${organization?.name || "Hotel Management System"}</p>
      <h2 style="margin: 0; color: #ffffff; font-size: 28px; line-height: 1.2; font-weight: 700;">Accept Invitation</h2>
    </div>

    <div style="padding: 32px 40px;">
      <p style="margin: 0 0 24px; color: #6b5a3a; font-size: 15px; line-height: 1.7;">
        Hello <strong style="color: #2d2004;">${name}</strong>, you have been invited to join the team below.
      </p>

      <div style="background: #fbf7f0; border: 1px solid rgba(176,141,87,0.18); border-radius: 14px; padding: 24px; margin-bottom: 24px;">
        <p style="margin: 0 0 12px; font-size: 15px; color: #4a3917;"><strong style="color: #b48a2c;">Organization:</strong> ${organization?.name || "-"}</p>
        <p style="margin: 0 0 12px; font-size: 15px; color: #4a3917;"><strong style="color: #b48a2c;">Branch:</strong> ${branch?.name || "Organization Level"}</p>
        <p style="margin: 0; font-size: 15px; color: #4a3917;"><strong style="color: #b48a2c;">Role:</strong> ${role}</p>
      </div>

      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${inviteLink}" style="display: inline-block; padding: 14px 28px; background-color: #b48a2c; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 10px; box-shadow: 0 10px 24px rgba(180,138,44,0.24);">
          Accept Invitation
        </a>
      </div>

      <div style="border-left: 4px solid #b48a2c; background: rgba(180,138,44,0.06); border-radius: 0 14px 14px 0; padding: 20px 22px;">
        <p style="margin: 0 0 10px; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #8a6a30; font-weight: 700;">Important</p>
        <p style="margin: 0 0 10px; font-size: 15px; line-height: 1.8; color: #3a2a10;">This invitation will expire in 10 minutes.</p>
        <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #6b5a3a; word-break: break-word;">If the button does not work, use this link: ${inviteLink}</p>
      </div>
    </div>
  </div>
</div>
`;

    await sendEmail(email, "You're Invited!", luxuryHtml);

    return res.status(201).json({
      message: "Invitation sent successfully",
      invitationId: invitation._id,
      expiresAt,
    });
  } catch (error) {
    console.error("🔥 CREATE INVITE ERROR:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

// ================= ACCEPT INVITE =================
exports.acceptInvitation = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        message: "Token and password are required",
      });
    }

    const invitation = await Invitation.findOne({ token });

    if (!invitation) {
      return res.status(400).json({
        message: "Invalid invitation link",
      });
    }

    if (invitation.status === "accepted") {
      return res.status(400).json({
        message: "Invitation already accepted",
      });
    }

    if (invitation.expiresAt < new Date()) {
      invitation.status = "expired";
      await invitation.save();

      return res.status(400).json({
        message: "Invitation link expired",
      });
    }

    const existingUser = await User.findOne({
      email: invitation.email,
    });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists with this email",
      });
    }

    if (
      (invitation.organizationId &&
        !(await ensureActiveOrganization(invitation.organizationId))) ||
      (invitation.branchId && !(await ensureActiveBranch(invitation.branchId)))
    ) {
      return res.status(400).json({
        message: "Invitation is no longer valid",
      });
    }

    // ✅ Create User
    const normalizedRole = normalizeInvitedRole(invitation.role);
    const roleDoc = await Role.findOne({
      normalizedName: normalizedRole,
    })
      .populate("permissions", "name key")
      .lean();

    const newUser = await User.create({
      name: invitation.name,
      email: invitation.email,
      password,
      role: normalizedRole,
      roleRef: roleDoc?._id || null,
      organizationId: invitation.organizationId,
      branchId: invitation.branchId?.toString(),
      permissions: Array.isArray(roleDoc?.permissions)
        ? roleDoc.permissions
            .map((permission) => permission.key || permission.name)
            .filter(Boolean)
        : [],
      isActive: true,
    });

    // ✅ Create Staff Automatically With Invitation Salary
    const Staff = require("../hr/staff.model");

    const nameParts = invitation.name.split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || "";
    const existingStaff = await Staff.findOne({
      email: invitation.email?.trim().toLowerCase(),
      branchId: invitation.branchId?.toString(),
    });

    if (!existingStaff) {
      await Staff.create({
        organizationId: invitation.organizationId?.toString(),
        branchId: invitation.branchId?.toString(),
        userId: newUser._id,
        firstName,
        lastName,
        email: invitation.email?.trim().toLowerCase(),
        department: getDepartmentFromRole(invitation.role),
        designation: normalizedRole,
        salary: Number.isFinite(Number(invitation.salary))
          ? Number(invitation.salary)
          : 0,
        joiningDate: new Date(),
        createdBy: newUser._id,
      });
    } else {
      existingStaff.organizationId = invitation.organizationId?.toString();
      existingStaff.branchId = invitation.branchId?.toString();
      existingStaff.userId = newUser._id;
      existingStaff.firstName = firstName;
      existingStaff.lastName = lastName;
      existingStaff.email = invitation.email?.trim().toLowerCase();
      existingStaff.department = getDepartmentFromRole(invitation.role);
      existingStaff.designation = normalizedRole;
      existingStaff.salary = Number.isFinite(Number(invitation.salary))
        ? Number(invitation.salary)
        : 0;
      existingStaff.createdBy = newUser._id;
      existingStaff.isActive = true;
      existingStaff.isDeleted = false;
      existingStaff.deletedAt = null;
      await existingStaff.save();
    }

    invitation.status = "accepted";
    await invitation.save();

    return res.status(201).json({
      message: "Account created successfully",
      userId: newUser._id,
      email: newUser.email,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server Error" });
  }
};

/// ================= GET PENDING INVITES =================
exports.getPendingInvitations = async (req, res) => {
  try {
    const user = req.user;

    let filter = { status: "pending" };

    if (user.role === "SUPER_ADMIN") {
      // no extra filter
    }

    if (user.role === "CORPORATE_ADMIN") {
      filter.organizationId = user.organizationId;
    }

    if (user.role === "BRANCH_MANAGER") {
      filter.branchId = user.branchId;
    }

    const invitations = await Invitation.find(filter)
      .populate("invitedBy", "name email")
      .sort({ createdAt: -1 });

    return res.status(200).json(invitations);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server Error" });
  }
};
// ================= RESEND INVITATION =================
exports.resendInvitation = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const invitation = await Invitation.findById(id);

    if (!invitation) {
      return res.status(404).json({
        message: "Invitation not found",
      });
    }

    if (invitation.status !== "pending") {
      return res.status(400).json({
        message: "Only pending invitations can be resent",
      });
    }

    // 🔐 Scope Validation

    if (user.role === "CORPORATE_ADMIN") {
      if (
        invitation.organizationId.toString() !== user.organizationId.toString()
      ) {
        return res.status(403).json({
          message: "Not allowed to resend this invitation",
        });
      }
    }

    if (user.role === "BRANCH_MANAGER") {
      if (
        invitation.branchId?.toString() !== user.branchId?.toString()
      ) {
        return res.status(403).json({
          message: "Not allowed to resend this invitation",
        });
      }
    }

    // 🔁 Generate New Token
    const crypto = require("crypto");
    const newToken = crypto.randomBytes(32).toString("hex");

    invitation.token = newToken;
    invitation.expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await invitation.save();

    // 📧 Send Email Again
    const sendEmail = require("../../utils/sendEmail");

    const baseUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");
    const inviteLink = `${baseUrl}/accept-invite?token=${newToken}`;

    const html = `
      <h2>Invitation Reminder</h2>
      <p>Hello ${invitation.name},</p>
      <p>This is a reminder to join as <strong>${invitation.role}</strong>.</p>
      <p>This invitation will expire in 10 minutes.</p>
      <a href="${inviteLink}"
         style="padding:10px 15px; background:#000; color:#fff; text-decoration:none;">
         Accept Invitation
      </a>
    `;

    const luxuryHtml = `
<div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4efe6; margin: 0; padding: 32px 16px; color: #2d2004;">
  <div style="max-width: 640px; margin: 0 auto; background: #fffdf9; border: 1px solid rgba(176,141,87,0.25); border-radius: 18px; overflow: hidden; box-shadow: 0 24px 60px rgba(32, 22, 4, 0.12);">
    <div style="background: linear-gradient(135deg, #18140d 0%, #2d220f 100%); padding: 32px 40px; border-bottom: 4px solid #b48a2c;">
      <p style="margin: 0 0 8px; color: #e2c98c; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; font-weight: 700;">Invitation Reminder</p>
      <h2 style="margin: 0; color: #ffffff; font-size: 28px; line-height: 1.2; font-weight: 700;">Accept Invitation</h2>
    </div>

    <div style="padding: 32px 40px;">
      <p style="margin: 0 0 24px; color: #6b5a3a; font-size: 15px; line-height: 1.7;">
        Hello <strong style="color: #2d2004;">${invitation.name}</strong>, this is a reminder to join as <strong style="color: #2d2004;">${invitation.role}</strong>.
      </p>

      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${inviteLink}" style="display: inline-block; padding: 14px 28px; background-color: #b48a2c; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 16px; border-radius: 10px; box-shadow: 0 10px 24px rgba(180,138,44,0.24);">
          Accept Invitation
        </a>
      </div>

      <div style="border-left: 4px solid #b48a2c; background: rgba(180,138,44,0.06); border-radius: 0 14px 14px 0; padding: 20px 22px;">
        <p style="margin: 0 0 10px; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: #8a6a30; font-weight: 700;">Important</p>
        <p style="margin: 0 0 10px; font-size: 15px; line-height: 1.8; color: #3a2a10;">This invitation will expire in 10 minutes.</p>
        <p style="margin: 0; font-size: 14px; line-height: 1.7; color: #6b5a3a; word-break: break-word;">If the button does not work, use this link: ${inviteLink}</p>
      </div>
    </div>
  </div>
</div>
    `;

    await sendEmail(invitation.email, "Invitation Reminder", luxuryHtml);

    return res.status(200).json({
      message: "Invitation resent successfully",
      expiresAt: invitation.expiresAt,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server Error" });
  }
};

// ================= CANCEL INVITATION =================
exports.cancelInvitation = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const invitation = await Invitation.findById(id);

    if (!invitation) {
      return res.status(404).json({
        message: "Invitation not found",
      });
    }

    if (invitation.status !== "pending") {
      return res.status(400).json({
        message: "Only pending invitations can be cancelled",
      });
    }

    // 🔐 Scope Validation

    if (user.role === "CORPORATE_ADMIN") {
      if (
        invitation.organizationId.toString() !== user.organizationId.toString()
      ) {
        return res.status(403).json({
          message: "Not allowed to cancel this invitation",
        });
      }
    }

    if (user.role === "BRANCH_MANAGER") {
      if (
        invitation.branchId?.toString() !== user.branchId?.toString()
      ) {
        return res.status(403).json({
          message: "Not allowed to cancel this invitation",
        });
      }
    }

    invitation.status = "expired";
    await invitation.save();

    return res.status(200).json({
      message: "Invitation cancelled successfully",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server Error" });
  }
};
