const Permission = require("./permission.model");
const Role = require("./role.model");
const User = require("../user/user.model");
const mongoose = require("mongoose");

const canManageRoles = (user) => user?.role === "SUPER_ADMIN";

const ACCOUNTANT_FINANCE_PERMISSIONS = [
  "ACCESS_FINANCE",
  "VIEW_INVOICE",
  "VIEW_EXPENSE",
];

const ensurePermissionDocs = async (keys) => {
  const normalizedKeys = [...new Set(keys.map((key) => String(key).trim().toUpperCase()))];
  const existingPermissions = await Permission.find({
    key: { $in: normalizedKeys },
  }).select("_id key");

  const existingByKey = new Map(
    existingPermissions.map((permission) => [permission.key, permission]),
  );

  for (const key of normalizedKeys) {
    if (!existingByKey.has(key)) {
      const created = await Permission.create({
        name: key,
        key,
        module: "FINANCE",
      });
      existingByKey.set(key, created);
    }
  }

  return normalizedKeys.map((key) => existingByKey.get(key)).filter(Boolean);
};

const ensureAccountantRolePermissions = async () => {
  const accountantRole = await Role.findOne({
    normalizedName: "ACCOUNTANT",
  });

  if (!accountantRole) {
    return;
  }

  const permissionDocs = await ensurePermissionDocs(ACCOUNTANT_FINANCE_PERMISSIONS);
  const nextPermissionIds = new Set(
    (accountantRole.permissions || []).map((permissionId) => permissionId.toString()),
  );

  let didChange = false;

  permissionDocs.forEach((permissionDoc) => {
    const permissionId = permissionDoc._id.toString();
    if (!nextPermissionIds.has(permissionId)) {
      nextPermissionIds.add(permissionId);
      didChange = true;
    }
  });

  if (didChange) {
    accountantRole.permissions = [...nextPermissionIds];
    await accountantRole.save();
  }
};

const canViewRoles = (user) => {
  if (user?.role === "SUPER_ADMIN" || user?.role === "CORPORATE_ADMIN") {
    return true;
  }

  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];

  return permissions.includes("VIEW_USER") || permissions.includes("ACCESS_USERS");
};

const getRoleAccessFilter = (user) => {
  if (user?.role === "SUPER_ADMIN") {
    return {};
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
    if (!canViewRoles(req.user)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    await ensureAccountantRolePermissions();

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

    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Role name is required",
      });
    }

    const normalizedName = name.toUpperCase().replace(/\s+/g, "_");
    const organizationId = null;

    const duplicate = await Role.findOne({
      normalizedName,
      $or: [{ organizationId }, { organizationId: { $exists: false } }],
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Role already exists",
      });
    }

    const role = await Role.create({
      name,
      normalizedName,
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

    console.error("Failed to create role", {
      name: req.body?.name,
      error: error?.message,
      stack: error?.stack,
    });

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

    const nextPermissionIds = permissionDocs.map((permission) => permission._id);
    const nextPermissionKeys = permissionDocs
      .map((permission) => permission.key || permission.name)
      .filter(Boolean);

    const updatedRole = await Role.findByIdAndUpdate(
      role._id,
      {
        $set: {
          permissions: nextPermissionIds,
        },
      },
      {
        new: true,
      },
    ).populate(
      "permissions",
      "_id name key module description",
    );

    await User.updateMany(
      {
        $or: [{ roleRef: role._id }, { role: role.normalizedName }],
      },
      {
        $set: {
          permissions: nextPermissionKeys,
          roleRef: role._id,
          role: role.normalizedName,
        },
      },
    );

    return res.status(200).json({
      success: true,
      message: "Permissions updated successfully",
      data: updatedRole,
    });
  } catch (error) {
    console.error("Failed to update role permissions", {
      roleId: req.params?.roleId,
      error: error?.message,
      stack: error?.stack,
    });

    const message =
      error?.name === "ValidationError" || error?.name === "CastError"
        ? error.message
        : "Failed to update permissions";

    return res.status(500).json({
      success: false,
      message,
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
