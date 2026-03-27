const Permission = require("./permission.model");
const Role = require("./role.model");
const User = require("../user/user.model");
const mongoose = require("mongoose");

const canManageRoles = (user) =>
  ["SUPER_ADMIN", "CORPORATE_ADMIN"].includes(user?.role);

const getRoleAccessFilter = (user) => {
  if (user?.role === "SUPER_ADMIN") {
    return {};
  }

  if (user?.role === "CORPORATE_ADMIN") {
    return {
      $or: [
        { type: "SYSTEM", normalizedName: { $ne: "SUPER_ADMIN" } },
        { organizationId: user.organizationId },
      ],
    };
  }

  return null;
};

const getAccessibleRoleQuery = (user, roleId) => {
  const accessFilter = getRoleAccessFilter(user);

  if (!accessFilter) {
    return null;
  }

  return accessFilter.$or
    ? { $and: [{ _id: roleId }, accessFilter] }
    : { _id: roleId };
};

/*
  Get Roles
*/
exports.getRoles = async (req, res) => {
  try {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    if (req.user?.role === "CORPORATE_ADMIN" && !req.user.organizationId) {
      return res.status(403).json({
        message: "Organization access is required",
      });
    }

    const filter = getRoleAccessFilter(req.user) || {};
    const roles = await Role.find(filter)
      .populate("permissions", "_id name key module description")
      .sort({ type: 1, name: 1 });

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

exports.createRole = async (req, res) => {
  try {
    if (!canManageRoles(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    if (req.user?.role === "CORPORATE_ADMIN" && !req.user.organizationId) {
      return res.status(403).json({
        success: false,
        message: "Organization access is required",
      });
    }

    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Role name is required",
      });
    }

    const normalizedName = name.toUpperCase().replace(/\s+/g, "_");
    const organizationId =
      req.user?.role === "CORPORATE_ADMIN" ? req.user.organizationId : null;

    const duplicate = await Role.findOne({
      normalizedName,
      organizationId,
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Role already exists",
      });
    }

    const role = await Role.create({
      name,
      description,
      type: "CUSTOM",
      organizationId,
      permissions: [],
    });

    const createdRole = await Role.findById(role._id).populate(
      "permissions",
      "_id name key module description",
    );

    return res.status(201).json({
      success: true,
      message: "Role created successfully",
      data: createdRole,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Role already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create role",
    });
  }
};

exports.updateRolePermissions = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { permissions } = req.body;

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

    if (!canManageRoles(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    if (req.user?.role === "CORPORATE_ADMIN" && !req.user.organizationId) {
      return res.status(403).json({
        success: false,
        message: "Organization access is required",
      });
    }

    const roleQuery = getAccessibleRoleQuery(req.user, roleId);
    const role = roleQuery ? await Role.findOne(roleQuery) : null;

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
          .map((permission) => permission.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];

    const permissionIds = normalizedPermissions.filter((permission) =>
      mongoose.Types.ObjectId.isValid(permission),
    );
    const permissionKeys = normalizedPermissions.filter(
      (permission) => !mongoose.Types.ObjectId.isValid(permission),
    );

    const query = [];

    if (permissionKeys.length > 0) {
      query.push({ key: { $in: permissionKeys } });
      query.push({ name: { $in: permissionKeys } });
    }

    if (permissionIds.length > 0) {
      query.push({ _id: { $in: permissionIds } });
    }

    const permissionDocs =
      query.length > 0
        ? await Permission.find({
            $or: query,
          }).select("_id name key")
        : [];

    if (permissionDocs.length !== normalizedPermissions.length) {
      const resolvedKeys = new Set(
        permissionDocs.flatMap((permission) => [
          permission._id.toString(),
          permission.name,
          permission.key,
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

    const updatedRole = await Role.findById(role._id).populate(
      "permissions",
      "_id name key module description",
    );

    return res.status(200).json({
      success: true,
      message: "Permissions updated successfully",
      data: updatedRole,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update permissions",
    });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    const { roleId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(roleId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid roleId",
      });
    }

    if (!canManageRoles(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    if (req.user?.role === "CORPORATE_ADMIN" && !req.user.organizationId) {
      return res.status(403).json({
        success: false,
        message: "Organization access is required",
      });
    }

    const roleQuery = getAccessibleRoleQuery(req.user, roleId);
    const role = roleQuery ? await Role.findOne(roleQuery) : null;

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    if (role.normalizedName === "SUPER_ADMIN" || role.type === "SYSTEM") {
      return res.status(400).json({
        success: false,
        message: "This role cannot be deleted",
      });
    }

    const assignedUsers = await User.countDocuments({
      $or: [{ roleRef: role._id }, { role: role.normalizedName }],
    });

    if (assignedUsers > 0) {
      return res.status(400).json({
        success: false,
        message: "This role is assigned to users and cannot be deleted",
      });
    }

    await Role.findByIdAndDelete(role._id);

    return res.status(200).json({
      success: true,
      message: "Role deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete role",
    });
  }
};
