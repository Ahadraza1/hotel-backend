const User = require("./user.model");
const Role = require("../rbac/role.model");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Staff = require("../hr/staff.model");

const ensureUserManagementAccess = (actor, targetUser) => {
  if (actor.role === "SUPER_ADMIN") {
    return true;
  }

  if (actor.role === "CORPORATE_ADMIN") {
    return (
      !!actor.organizationId &&
      targetUser.organizationId?.toString() === actor.organizationId?.toString()
    );
  }

  return false;
};

const softDeleteLinkedStaff = async (user) => {
  if (!user?._id) {
    return null;
  }

  console.log("Deleting user:", user._id);

  return Staff.findOneAndUpdate(
    {
      userId: user._id,
      branchId: user.branchId,
      isDeleted: { $ne: true },
    },
    {
      isDeleted: true,
      deletedAt: new Date(),
      isActive: false,
    },
    { new: true },
  );
};

/*
  Get Current Logged In User
*/
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findOne({
      _id: req.user.id,
      isDeleted: { $ne: true },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      data: {
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar || null,
      },
    });
  } catch (error) {
    console.error("Get current user error:", error);
    return res.status(500).json({
      message: "Failed to fetch user",
    });
  }
};

/*
  Get Users
*/
exports.getUsers = async (req, res) => {
  try {
    if (!["SUPER_ADMIN", "CORPORATE_ADMIN"].includes(req.user.role)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const filter = {
      isDeleted: { $ne: true },
    };

    if (req.user.role === "CORPORATE_ADMIN") {
      if (!req.user.organizationId) {
        return res.status(403).json({
          message: "Organization access is required",
        });
      }

      filter.organizationId = req.user.organizationId;
    }

    const users = await User.find(filter)
      .select("-password")
      .populate("roleRef", "_id name normalizedName");

    res.status(200).json({
      count: users.length,
      data: users,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch users",
    });
  }
};

/*
  Update Current User
*/
exports.updateCurrentUser = async (req, res) => {
  try {
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: req.user.userId,
        isDeleted: { $ne: true },
      },
      req.body,
      { new: true }
    ).select("-password");

    res.status(200).json({
      message: "Profile updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update profile",
    });
  }
};

/*
  Update Password
*/
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters",
      });
    }

    const user = await User.findOne({
      _id: req.user.userId || req.user.id,
      isDeleted: { $ne: true },
    }).select("+password");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );

    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        message: "Current password is incorrect",
      });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Update password error:", error);
    return res.status(500).json({
      message: "Failed to update password",
    });
  }
};

/*
  Update Avatar
*/
exports.updateAvatar = async (req, res) => {
  try {
    const user = await User.findOne({
      _id: req.user.id,
      isDeleted: { $ne: true },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!req.file) {
      user.avatar = null;
      await user.save();

      return res.status(200).json({
        message: "Avatar removed successfully",
        data: {
          avatar: null,
        },
      });
    }

    const avatarUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;

    user.avatar = avatarUrl;
    await user.save();

    return res.status(200).json({
      message: "Avatar updated successfully",
      data: {
        avatar: avatarUrl,
      },
    });
  } catch (error) {
    console.error("Avatar update error:", error);
    return res.status(500).json({
      message: "Failed to update avatar",
    });
  }
};

/*
  Delete Current User Account
*/
exports.deleteCurrentUser = async (req, res) => {
  try {
    const user = await User.findOne({
      _id: req.user.userId || req.user.id,
      isDeleted: { $ne: true },
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    user.isDeleted = true;
    user.deletedAt = new Date();
    user.isActive = false;
    await user.save();
    await softDeleteLinkedStaff(user);

    return res.status(200).json({
      message: "Account deleted successfully",
    });
  } catch (error) {
    console.error("Delete current user error:", error);
    return res.status(500).json({
      message: "Failed to delete account",
    });
  }
};

/*
  Change User Role (Enhanced)
  PATCH /users/:userId/role
*/
exports.changeUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const roleId = req.body?.roleId;
    const roleKey = String(req.body?.role || "").trim().toUpperCase();

    // 1. Restriction: Only Super Admin can edit roles
    if (req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can change user roles",
      });
    }

    if (!roleId && !roleKey) {
      return res.status(400).json({
        success: false,
        message: "role or roleId is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId",
      });
    }

    if (roleId && !mongoose.Types.ObjectId.isValid(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid roleId",
      });
    }

    // 2. Fetch target user
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 3. Fetch the new role and its permissions
    const roleQuery = roleId
      ? { _id: roleId }
      : {
          $or: [{ normalizedName: roleKey }, { name: roleKey.replace(/_/g, " ") }],
        };
    const newRole = await Role.findOne(roleQuery).populate("permissions");
    if (!newRole) {
      return res.status(404).json({
        success: false,
        message: "Selected role not found",
      });
    }

    // 4. Update user:
    // - Use normalized name for consistency across auth/session handling
    const normalizedRoleName = newRole.normalizedName || newRole.name.toUpperCase().replace(/\s+/g, "_");

    if (
      targetUser.role === normalizedRoleName &&
      targetUser.roleRef?.toString() === newRole._id.toString()
    ) {
      const existingUser = await User.findById(targetUser._id)
        .select("-password")
        .populate("roleRef", "_id name normalizedName");

      return res.status(200).json({
        success: true,
        message: "User role updated successfully",
        user: existingUser,
      });
    }

    targetUser.role = normalizedRoleName;
    targetUser.roleRef = newRole._id;
    
    // Assign permission keys/names to user.permissions
    // Ensure we handle case where permission population might return nulls or non-documents
    targetUser.permissions = (newRole.permissions || [])
      .filter(p => p && (p.key || p.name))
      .map(p => p.key || p.name);

    await targetUser.save();

    const updatedUser = await User.findById(targetUser._id)
      .select("-password")
      .populate("roleRef", "_id name normalizedName");

    return res.status(200).json({
      success: true,
      message: "User role updated successfully",
      user: updatedUser
    });
  } catch (error) {
    console.error("Change role error FULL DETAILS:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update user role",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined
    });
  }
};

/*
  Update User Status
*/
exports.updateUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        message: "isActive must be a boolean",
      });
    }

    if (!["SUPER_ADMIN", "CORPORATE_ADMIN"].includes(req.user.role)) {
      return res.status(403).json({
        message: "Unauthorized",
      });
    }

    const targetUser = await User.findById(userId).select("-password");

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!ensureUserManagementAccess(req.user, targetUser)) {
      return res.status(403).json({
        message: "Unauthorized",
      });
    }

    targetUser.isActive = isActive;
    await targetUser.save();

    return res.status(200).json({
      message: isActive
        ? "User Activated Successfully"
        : "User Deactivated Successfully",
      data: targetUser,
    });
  } catch (error) {
    console.error("Update user status error:", error);
    return res.status(500).json({
      message: "Failed to update user status",
    });
  }
};

/*
  Delete User
*/
exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!["SUPER_ADMIN", "CORPORATE_ADMIN"].includes(req.user.role)) {
      return res.status(403).json({
        message: "Unauthorized",
      });
    }

    const targetUser = await User.findById(userId).select("-password");

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!ensureUserManagementAccess(req.user, targetUser)) {
      return res.status(403).json({
        message: "Unauthorized",
      });
    }

    await softDeleteLinkedStaff(targetUser);
    await User.findByIdAndDelete(userId);

    return res.status(200).json({
      message: "User Deleted Successfully",
    });
  } catch (error) {
    console.error("Delete user error:", error);
    return res.status(500).json({
      message: "Failed to delete user",
    });
  }
};
