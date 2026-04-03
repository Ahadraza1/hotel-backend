const Permission = require("./permission.model");
const Role = require("./role.model");
const User = require("../user/user.model");
const Organization = require("../organization/organization.model");
const mongoose = require("mongoose");

const canManageRoles = (user) => user?.role === "SUPER_ADMIN";
const normalizePermissions = (permissions = []) =>
  permissions
    .filter((permission) => typeof permission === "string")
    .map((permission) => permission.trim().toUpperCase())
    .filter(Boolean);

const hasRbacPermission = (user, permission) => {
  if (user?.isPlatformAdmin || user?.role === "SUPER_ADMIN") {
    return true;
  }

  return normalizePermissions(user?.permissions).includes(
    String(permission || "").trim().toUpperCase(),
  );
};

const ACCOUNTANT_FINANCE_PERMISSIONS = [
  "ACCESS_FINANCE",
  "VIEW_INVOICE",
  "VIEW_EXPENSE",
];
const ROLE_CATEGORY = {
  MAIN: "MAIN",
  ORGANIZATION: "ORGANIZATION",
  BRANCH: "BRANCH",
};
const UI_CREATABLE_ROLE_CATEGORIES = Object.values(ROLE_CATEGORY);

const normalizeRoleName = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

const normalizeScopeId = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const resolveOrganizationScopeId = async (value) => {
  const normalized = normalizeScopeId(value);

  if (!normalized) {
    return null;
  }

  const directMatch = await Organization.findOne({
    organizationId: normalized,
  })
    .select("organizationId")
    .lean();

  if (directMatch?.organizationId) {
    return directMatch.organizationId;
  }

  if (!mongoose.Types.ObjectId.isValid(normalized)) {
    return normalized;
  }

  const objectIdMatch = await Organization.findById(normalized)
    .select("organizationId")
    .lean();

  return objectIdMatch?.organizationId || normalized;
};

const getRoleScopeFromRequest = async (req) => ({
  organizationId: await resolveOrganizationScopeId(
    req.query?.organizationId ?? req.body?.organizationId,
  ),
  branchId: normalizeScopeId(req.query?.branchId ?? req.body?.branchId),
});

const mergeAndClauses = (...clauses) => {
  const normalizedClauses = clauses.filter(Boolean).flatMap((clause) => {
    if (!clause || Object.keys(clause).length === 0) {
      return [];
    }

    return clause.$and ? clause.$and : [clause];
  });

  if (normalizedClauses.length === 0) {
    return {};
  }

  if (normalizedClauses.length === 1) {
    return normalizedClauses[0];
  }

  return { $and: normalizedClauses };
};

const getBranchNullFilter = () => ({
  $or: [{ branchId: null }, { branchId: { $exists: false } }, { branchId: "" }],
});

const getRoleScopeFilter = ({ organizationId = null, branchId = null } = {}) => {
  const normalizedOrganizationId = normalizeScopeId(organizationId);
  const normalizedBranchId = normalizeScopeId(branchId);

  if (!normalizedOrganizationId && !normalizedBranchId) {
    return {
      $or: [
        { category: ROLE_CATEGORY.MAIN },
        { normalizedName: "SUPER_ADMIN" },
        { name: "SUPER_ADMIN" },
        { name: "Super Admin" },
      ],
    };
  }

  if (normalizedBranchId) {
    return mergeAndClauses(
      {
        organizationId: normalizedOrganizationId,
        branchId: normalizedBranchId,
      },
      {
        $or: [
          { category: ROLE_CATEGORY.BRANCH },
          { category: { $exists: false } },
          { category: null },
          { category: "" },
        ],
      },
    );
  }

  if (normalizedOrganizationId) {
    return mergeAndClauses(
      {
        organizationId: normalizedOrganizationId,
      },
      getBranchNullFilter(),
      {
        $or: [
          { category: ROLE_CATEGORY.ORGANIZATION },
          { normalizedName: "CORPORATE_ADMIN" },
          { name: "CORPORATE_ADMIN" },
          { name: "Corporate Admin" },
          { category: { $exists: false } },
          { category: null },
          { category: "" },
        ],
      },
    );
  }

  return {};
};

const getScopedAccessContext = async (user, requestedScope = {}) => {
  const requestedOrganizationId = await resolveOrganizationScopeId(
    requestedScope.organizationId,
  );
  const requestedBranchId = normalizeScopeId(requestedScope.branchId);

  if (requestedBranchId && !requestedOrganizationId && user?.role !== "CORPORATE_ADMIN") {
    return {
      error: {
        status: 400,
        message: "organizationId is required when branchId is provided",
      },
    };
  }

  if (user?.role === "CORPORATE_ADMIN") {
    const organizationId = normalizeScopeId(user.organizationId);

    if (!organizationId) {
      return {
        error: {
          status: 403,
          message: "Organization access is required",
        },
      };
    }

    if (requestedOrganizationId && requestedOrganizationId !== organizationId) {
      return {
        error: {
          status: 403,
          message: "Access denied for the selected organization",
        },
      };
    }

    return {
      organizationId,
      branchId: requestedBranchId,
    };
  }

  return {
    organizationId: requestedOrganizationId,
    branchId: requestedBranchId,
  };
};

const getUserScopeFilterForRole = (role) => {
  const scopeFilter = [];
  const organizationId = normalizeScopeId(role?.organizationId);
  const branchId = normalizeScopeId(role?.branchId);

  if (organizationId) {
    scopeFilter.push({ organizationId });
  } else {
    scopeFilter.push({
      $or: [
        { organizationId: null },
        { organizationId: { $exists: false } },
        { organizationId: "" },
      ],
    });
  }

  if (branchId) {
    scopeFilter.push({ branchId });
  } else {
    scopeFilter.push(getBranchNullFilter());
  }

  return mergeAndClauses(...scopeFilter);
};

const ensureNormalizedRoleNames = async () => {
  const legacyRoles = await Role.find({
    $or: [
      { normalizedName: { $exists: false } },
      { normalizedName: null },
      { normalizedName: "" },
    ],
  })
    .select("_id name")
    .lean();

  if (legacyRoles.length === 0) {
    return;
  }

  await Role.bulkWrite(
    legacyRoles
      .map((role) => {
        const normalizedName = normalizeRoleName(role.name);

        if (!normalizedName) {
          return null;
        }

        return {
          updateOne: {
            filter: {
              _id: role._id,
              $or: [
                { normalizedName: { $exists: false } },
                { normalizedName: null },
                { normalizedName: "" },
              ],
            },
            update: {
              $set: {
                normalizedName,
              },
            },
          },
        };
      })
      .filter(Boolean),
  );
};

const getRoleCategory = (role) => {
  const normalizedName = normalizeRoleName(role?.normalizedName || role?.name);

  if (normalizedName === "SUPER_ADMIN") {
    return ROLE_CATEGORY.MAIN;
  }

  if (normalizedName === "CORPORATE_ADMIN") {
    return ROLE_CATEGORY.ORGANIZATION;
  }

  return role?.category || ROLE_CATEGORY.BRANCH;
};

const ensureSystemRoles = async () => {
  await ensureNormalizedRoleNames();

  await Role.findOneAndUpdate(
    {
      normalizedName: "WAITER",
      organizationId: null,
      $or: [{ branchId: null }, { branchId: { $exists: false } }, { branchId: "" }],
    },
    {
      $setOnInsert: {
        name: "Waiter",
        normalizedName: "WAITER",
        description: "",
        category: ROLE_CATEGORY.BRANCH,
        branchId: null,
        permissions: [],
      },
    },
    {
      returnDocument: "after",
      upsert: true,
    },
  );
};

const ensureBaseRoleCategories = async () => {
  await Role.updateMany(
    { normalizedName: "SUPER_ADMIN" },
    { $set: { category: ROLE_CATEGORY.MAIN } },
  );

  await Role.updateMany(
    { normalizedName: "CORPORATE_ADMIN" },
    { $set: { category: ROLE_CATEGORY.ORGANIZATION } },
  );

  await Role.updateMany(
    {
      normalizedName: { $nin: ["SUPER_ADMIN", "CORPORATE_ADMIN"] },
      $or: [
        { category: { $exists: false } },
        { category: null },
        { category: "" },
      ],
    },
    { $set: { category: ROLE_CATEGORY.BRANCH } },
  );
};

const ensurePermissionDocs = async (keys) => {
  const normalizedKeys = [
    ...new Set(keys.map((key) => String(key).trim().toUpperCase()).filter(Boolean)),
  ];

  const existingPermissions = await Permission.find({
    $or: [{ key: { $in: normalizedKeys } }, { name: { $in: normalizedKeys } }],
  }).select("_id key name module");

  const existingByKey = new Map();
  const permissionUpdates = [];

  existingPermissions.forEach((permission) => {
    const normalizedKey = String(permission.key || permission.name || "")
      .trim()
      .toUpperCase();

    if (!normalizedKey) {
      return;
    }

    existingByKey.set(normalizedKey, permission);

    if (
      String(permission.key || "").trim().toUpperCase() !== normalizedKey ||
      String(permission.module || "").trim().toUpperCase() !== "FINANCE"
    ) {
      permissionUpdates.push({
        updateOne: {
          filter: { _id: permission._id },
          update: {
            $set: {
              key: normalizedKey,
              module: String(permission.module || "FINANCE")
                .trim()
                .toUpperCase(),
            },
          },
        },
      });
    }
  });

  if (permissionUpdates.length > 0) {
    await Permission.bulkWrite(permissionUpdates);
  }

  for (const key of normalizedKeys) {
    if (!existingByKey.has(key)) {
      try {
        const created = await Permission.create({
          name: key,
          key,
          module: "FINANCE",
        });
        existingByKey.set(key, created);
      } catch (error) {
        if (error?.code !== 11000) {
          throw error;
        }

        const existingPermission = await Permission.findOne({
          $or: [{ key }, { name: key }],
        }).select("_id key name module");

        if (!existingPermission) {
          throw error;
        }

        existingByKey.set(key, existingPermission);
      }
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

const ensureOrganizationCorporateAdminRole = async (organizationId) => {
  const normalizedOrganizationId = normalizeScopeId(organizationId);

  if (!normalizedOrganizationId) {
    return null;
  }

  const existingScopedRole = await Role.findOne({
    normalizedName: "CORPORATE_ADMIN",
    organizationId: normalizedOrganizationId,
    $or: [{ branchId: null }, { branchId: { $exists: false } }, { branchId: "" }],
  });

  if (existingScopedRole) {
    return existingScopedRole;
  }

  const templateRole = await Role.findOne({
    normalizedName: "CORPORATE_ADMIN",
    $or: [
      { organizationId: null },
      { organizationId: { $exists: false } },
      { organizationId: "" },
    ],
  }).select("name normalizedName description type permissions");

  if (!templateRole) {
    return null;
  }

  const scopedRole = await Role.findOneAndUpdate(
    {
      normalizedName: "CORPORATE_ADMIN",
      organizationId: normalizedOrganizationId,
      $or: [{ branchId: null }, { branchId: { $exists: false } }, { branchId: "" }],
    },
    {
      $setOnInsert: {
        name: templateRole.name || "CORPORATE_ADMIN",
        normalizedName: "CORPORATE_ADMIN",
        description: templateRole.description || "",
        type: templateRole.type || "CUSTOM",
        category: ROLE_CATEGORY.ORGANIZATION,
        organizationId: normalizedOrganizationId,
        branchId: null,
        permissions: templateRole.permissions || [],
      },
    },
    {
      new: true,
      upsert: true,
    },
  );

  const populatedRole = await Role.findById(scopedRole._id).populate(
    "permissions",
    "_id name key module description",
  );
  const permissionKeys = (populatedRole?.permissions || [])
    .map((permission) => permission.key || permission.name)
    .filter(Boolean);

  await User.updateMany(
    {
      organizationId: normalizedOrganizationId,
      role: "CORPORATE_ADMIN",
      $or: [{ branchId: null }, { branchId: { $exists: false } }, { branchId: "" }],
    },
    {
      $set: {
        roleRef: scopedRole._id,
        permissions: permissionKeys,
      },
    },
  );

  return populatedRole;
};

const ensureBranchScopedRoles = async (organizationId, branchId) => {
  const normalizedOrganizationId = normalizeScopeId(organizationId);
  const normalizedBranchId = normalizeScopeId(branchId);

  if (!normalizedOrganizationId || !normalizedBranchId) {
    return [];
  }

  const branchTemplates = await Role.find(
    mergeAndClauses(
      { category: ROLE_CATEGORY.BRANCH },
      {
        $or: [
          { organizationId: null },
          { organizationId: { $exists: false } },
          { organizationId: "" },
        ],
      },
      {
        $or: [
          { branchId: null },
          { branchId: { $exists: false } },
          { branchId: "" },
        ],
      },
    ),
  ).select("name normalizedName description type permissions");

  if (branchTemplates.length === 0) {
    return [];
  }

  const createdOrExistingRoles = [];

  for (const templateRole of branchTemplates) {
    const scopedRole = await Role.findOneAndUpdate(
      {
        normalizedName: templateRole.normalizedName,
        organizationId: normalizedOrganizationId,
        branchId: normalizedBranchId,
      },
      {
        $setOnInsert: {
          name: templateRole.name,
          normalizedName: templateRole.normalizedName,
          description: templateRole.description || "",
          type: templateRole.type || "CUSTOM",
          category: ROLE_CATEGORY.BRANCH,
          organizationId: normalizedOrganizationId,
          branchId: normalizedBranchId,
          permissions: templateRole.permissions || [],
        },
      },
      {
        new: true,
        upsert: true,
      },
    );

    createdOrExistingRoles.push(scopedRole);
  }

  const populatedRoles = await Role.find({
    _id: { $in: createdOrExistingRoles.map((role) => role._id) },
  }).populate("permissions", "_id name key module description");

  const scopedRoleMap = new Map(
    populatedRoles.map((role) => [role.normalizedName, role]),
  );

  for (const [normalizedName, scopedRole] of scopedRoleMap) {
    const permissionKeys = (scopedRole.permissions || [])
      .map((permission) => permission.key || permission.name)
      .filter(Boolean);

    await User.updateMany(
      {
        organizationId: normalizedOrganizationId,
        branchId: normalizedBranchId,
        role: normalizedName,
      },
      {
        $set: {
          roleRef: scopedRole._id,
          permissions: permissionKeys,
        },
      },
    );
  }

  return populatedRoles;
};

const canViewRoles = (user) => {
  if (user?.role === "SUPER_ADMIN" || user?.role === "CORPORATE_ADMIN") {
    return true;
  }

  const permissions = normalizePermissions(user?.permissions);

  return (
    permissions.includes("VIEW_USER") ||
    permissions.includes("ACCESS_USERS") ||
    permissions.includes("ACCESS_ROLE_PERMISSIONS_PAGE") ||
    permissions.includes("ACCESS_ROLES") ||
    permissions.includes("ACCESS_PERMISSIONS") ||
    permissions.includes("ADD_ROLE") ||
    permissions.includes("TOGGLE_PERMISSION")
  );
};

const getRoleAccessFilter = (user) => {
  if (user?.role === "SUPER_ADMIN") {
    return {};
  }

  const organizationScope = [
    { organizationId: null },
    { organizationId: { $exists: false } },
  ];

  if (user?.organizationId) {
    organizationScope.push({ organizationId: String(user.organizationId) });
  }

  return {
    category: {
      $in: [ROLE_CATEGORY.ORGANIZATION, ROLE_CATEGORY.BRANCH],
    },
    $or: organizationScope,
  };
};

const getAccessibleRoleQuery = (user, roleId) => {
  const accessFilter = getRoleAccessFilter(user);

  if (!accessFilter) {
    return null;
  }

  return accessFilter.$or
    ? { $and: [{ _id: roleId }, accessFilter] }
    : { _id: roleId, ...accessFilter };
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

    await ensureSystemRoles();
    await ensureBaseRoleCategories();
    await ensureAccountantRolePermissions();

    const scopedAccess = await getScopedAccessContext(
      req.user,
      await getRoleScopeFromRequest(req),
    );
    if (scopedAccess.error) {
      return res.status(scopedAccess.error.status).json({
        message: scopedAccess.error.message,
      });
    }

    if (scopedAccess.organizationId && scopedAccess.branchId) {
      await ensureBranchScopedRoles(
        scopedAccess.organizationId,
        scopedAccess.branchId,
      );
    }

    if (scopedAccess.organizationId && !scopedAccess.branchId) {
      await ensureOrganizationCorporateAdminRole(scopedAccess.organizationId);
    }

    const filter = mergeAndClauses(
      getRoleAccessFilter(req.user) || {},
      getRoleScopeFilter(scopedAccess),
    );
    const roles = await Role.find(filter)
      .populate("permissions", "_id name key module description")
      .sort({ type: 1, name: 1 });

    res.status(200).json({
      count: roles.length,
      data: roles,
    });
  } catch (error) {
    console.error("Failed to fetch roles", {
      userId: req.user?._id || req.user?.id || null,
      role: req.user?.role || null,
      organizationId: req.user?.organizationId || null,
      error: error?.message,
      stack: error?.stack,
    });

    res.status(500).json({
      message: "Failed to fetch roles",
    });
  }
};

exports.createRole = async (req, res) => {
  try {
    if (!hasRbacPermission(req.user, "ADD_ROLE")) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const requestedCategory = String(req.body?.category || ROLE_CATEGORY.BRANCH)
      .trim()
      .toUpperCase();

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Role name is required",
      });
    }

    if (!UI_CREATABLE_ROLE_CATEGORIES.includes(requestedCategory)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role category",
      });
    }

    const normalizedName = normalizeRoleName(name);

    if (normalizedName === "SUPER_ADMIN") {
      return res.status(400).json({
        success: false,
        message: "Super Admin role cannot be created from this form",
      });
    }

    const scopedAccess = await getScopedAccessContext(
      req.user,
      await getRoleScopeFromRequest(req),
    );
    if (scopedAccess.error) {
      return res.status(scopedAccess.error.status).json({
        success: false,
        message: scopedAccess.error.message,
      });
    }

    const organizationId = normalizeScopeId(scopedAccess.organizationId);
    const branchId = normalizeScopeId(scopedAccess.branchId);
    const category = branchId
      ? ROLE_CATEGORY.BRANCH
      : organizationId
        ? ROLE_CATEGORY.ORGANIZATION
        : ROLE_CATEGORY.MAIN;

    if (category === ROLE_CATEGORY.MAIN && req.user?.role !== "SUPER_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can create global roles",
      });
    }

    if (category === ROLE_CATEGORY.ORGANIZATION && !organizationId) {
      return res.status(400).json({
        success: false,
        message: "Select an organization before creating an organization role",
      });
    }

    if (category === ROLE_CATEGORY.BRANCH) {
      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: "Select an organization before creating a branch role",
        });
      }

      if (!branchId) {
        return res.status(400).json({
          success: false,
          message: "Select a branch before creating a branch role",
        });
      }
    }

    const duplicate = await Role.findOne(
      mergeAndClauses(
        { normalizedName },
        getRoleScopeFilter({ organizationId, branchId }),
      ),
    ).lean();

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
      category,
      organizationId: category === ROLE_CATEGORY.MAIN ? null : organizationId,
      branchId: category === ROLE_CATEGORY.BRANCH ? branchId : null,
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
    await ensureSystemRoles();
    await ensureBaseRoleCategories();

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

    if (!hasRbacPermission(req.user, "TOGGLE_PERMISSION")) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const scopedAccess = await getScopedAccessContext(
      req.user,
      await getRoleScopeFromRequest(req),
    );
    if (scopedAccess.error) {
      return res.status(scopedAccess.error.status).json({
        success: false,
        message: scopedAccess.error.message,
      });
    }

    const roleQuery = mergeAndClauses(
      getAccessibleRoleQuery(req.user, roleId) || { _id: roleId },
      getRoleScopeFilter(scopedAccess),
    );
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
      mergeAndClauses(
        {
          $or: [{ roleRef: role._id }, { role: role.normalizedName }],
        },
        getUserScopeFilterForRole(role),
      ),
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

    await ensureSystemRoles();
    await ensureBaseRoleCategories();

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

    if (
      getRoleCategory(role) === ROLE_CATEGORY.MAIN ||
      role.normalizedName === "SUPER_ADMIN" ||
      role.type === "SYSTEM"
    ) {
      return res.status(400).json({
        success: false,
        message: "This role cannot be deleted",
      });
    }

    const assignedUsers = await User.countDocuments({
      $and: [
        {
          $or: [{ roleRef: role._id }, { role: role.normalizedName }],
        },
        getUserScopeFilterForRole(role),
      ],
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
