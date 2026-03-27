const User = require("./user.model");
const bcrypt = require("bcryptjs");

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

/*
  Get Current Logged In User
*/
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

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

    const filter = {};

    if (req.user.role === "CORPORATE_ADMIN") {
      if (!req.user.organizationId) {
        return res.status(403).json({
          message: "Organization access is required",
        });
      }

      filter.organizationId = req.user.organizationId;
    }

    const users = await User.find(filter).select("-password");

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
    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
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

    const user = await User.findById(req.user.userId || req.user.id).select("+password");

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
    const user = await User.findById(req.user.id);

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
  Change User Role
*/
exports.changeUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({
        message: "Role is required",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    user.role = role;
    await user.save();

    return res.status(200).json({
      message: "User role updated successfully",
      data: {
        userId: user._id,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Change role error:", error);
    return res.status(500).json({
      message: "Failed to change user role",
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
