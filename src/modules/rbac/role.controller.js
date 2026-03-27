const Permission = require("./permission.model");
const Role = require("./role.model");
const mongoose = require("mongoose");

/*
  Get Roles
*/
exports.getRoles = async (req, res) => {
  try {
    if (!["SUPER_ADMIN", "CORPORATE_ADMIN"].includes(req.user?.role)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    const filter = {};

    if (req.user?.role === "CORPORATE_ADMIN") {
      if (!req.user.organizationId) {
        return res.status(403).json({
          message: "Organization access is required",
        });
      }

      filter.name = { $ne: "SUPER_ADMIN" };
    }

    const roles = await Role.find(filter).populate("permissions");

    res.status(200).json({
      count: roles.length,
      data: roles,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch roles",
    });
  }
};

exports.updateRolePermissions = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { permissions } = req.body;

    console.log("updateRolePermissions payload:", {
      roleId,
      permissions,
    });

    if (!mongoose.Types.ObjectId.isValid(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid roleId",
      });
    }

    if (!Array.isArray(permissions)) {
      return res.status(400).json({
        success: false,
        message: "Permissions array is required",
      });
    }

    const role = await Role.findById(roleId);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    const normalizedPermissions = [
      ...new Set(
        permissions
          .filter((permission) => typeof permission === "string")
          .map((permission) => permission.trim())
          .filter(Boolean),
      ),
    ];

    const permissionIds = normalizedPermissions.filter((permission) =>
      mongoose.Types.ObjectId.isValid(permission),
    );
    const permissionNames = normalizedPermissions.filter(
      (permission) => !mongoose.Types.ObjectId.isValid(permission),
    );

    const query = [];

    if (permissionNames.length > 0) {
      query.push({ name: { $in: permissionNames } });
    }

    if (permissionIds.length > 0) {
      query.push({ _id: { $in: permissionIds } });
    }

    const permissionDocs =
      query.length > 0
        ? await Permission.find({
            $or: query,
          }).select("_id name")
        : [];

    if (permissionDocs.length !== normalizedPermissions.length) {
      const resolvedKeys = new Set(
        permissionDocs.flatMap((permission) => [
          permission._id.toString(),
          permission.name,
        ]),
      );

      const invalidPermissions = normalizedPermissions.filter(
        (permission) => !resolvedKeys.has(permission),
      );

      return res.status(400).json({
        success: false,
        message: "Some permissions are invalid",
        invalidPermissions,
      });
    }

    role.permissions = permissionDocs.map((permission) => permission._id);
    await role.save();

    const updatedRole = await Role.findById(role._id).populate("permissions");

    return res.status(200).json({
      success: true,
      message: "Permissions updated successfully",
      data: updatedRole,
    });
  } catch (error) {
    console.error("updateRolePermissions error:", {
      message: error.message,
      name: error.name,
      stack: error.stack,
      roleId: req.params?.roleId,
      permissions: req.body?.permissions,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to update permissions",
    });
  }
};
