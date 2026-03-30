const Role = require("../modules/rbac/role.model");

const PERMISSION_ALIASES = {
  ACCESS_ROOM: ["ACCESS_ROOMS"],
  ACCESS_ROOMS: ["ACCESS_ROOM"],
  ACCESS_BOOKING: ["ACCESS_BOOKINGS"],
  ACCESS_BOOKINGS: ["ACCESS_BOOKING"],
  VIEW_ROOM: ["VIEW_ROOMS"],
  VIEW_ROOMS: ["VIEW_ROOM"],
  VIEW_BOOKING: ["VIEW_BOOKINGS"],
  VIEW_BOOKINGS: ["VIEW_BOOKING"],
  VIEW_GUEST: ["VIEW_CRM"],
  VIEW_CRM: ["VIEW_GUEST"],
  VIEW_TASK: ["VIEW_HOUSEKEEPING"],
  VIEW_HOUSEKEEPING: ["VIEW_TASK"],
  VIEW_POS_MENU: ["VIEW_POS"],
  VIEW_POS: ["VIEW_POS_MENU"],
  VIEW_INVENTORY_ITEM: ["VIEW_INVENTORY"],
  VIEW_INVENTORY: ["VIEW_INVENTORY_ITEM"],
  VIEW_EMPLOYEE: ["VIEW_HR"],
  VIEW_HR: ["VIEW_EMPLOYEE"],
  VIEW_EXPENSE: ["VIEW_FINANCE"],
  VIEW_FINANCE: ["VIEW_EXPENSE"],
  VIEW_INVOICE: ["VIEW_EXPENSE", "VIEW_FINANCE"],
  VIEW_EXPENSE: ["VIEW_FINANCE", "VIEW_INVOICE"],
  VIEW_FINANCE: ["VIEW_EXPENSE", "VIEW_INVOICE"],
};

const normalizePermissions = (permissions = []) =>
  {
    const normalized = permissions
      .filter((permission) => typeof permission === "string")
      .map((permission) => permission.trim().toUpperCase())
      .filter(Boolean);

    const expanded = new Set();

    normalized.forEach((permission) => {
      expanded.add(permission);

      const aliases = PERMISSION_ALIASES[permission] || [];
      aliases.forEach((alias) => expanded.add(alias));
    });

    return [...expanded];
  };

const getRoleCandidates = (user) => {
  const normalizedRole = String(user?.role || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  const rawRole = String(user?.role || "").trim();

  return [
    ...(user?.roleRef ? [{ _id: user.roleRef }] : []),
    ...(user?.organizationId && normalizedRole
      ? [{ normalizedName: normalizedRole, organizationId: user.organizationId }]
      : []),
    ...(user?.organizationId && rawRole
      ? [{ name: rawRole, organizationId: user.organizationId }]
      : []),
    ...(normalizedRole ? [{ normalizedName: normalizedRole, organizationId: null }] : []),
    ...(rawRole ? [{ name: rawRole, organizationId: null }] : []),
    ...(normalizedRole ? [{ normalizedName: normalizedRole }] : []),
    ...(rawRole ? [{ name: rawRole }] : []),
  ];
};

const findRoleForUser = async (user) => {
  const candidates = getRoleCandidates(user);

  for (const query of candidates) {
    const roleDoc = await Role.findOne(query).populate("permissions", "name key");

    if (roleDoc) {
      return roleDoc;
    }
  }

  return null;
};

const extractPermissionKeys = (permissions = []) =>
  permissions
    .map((permission) => {
      if (typeof permission === "string") {
        return permission;
      }

      if (permission && typeof permission === "object") {
        return permission.key || permission.name || "";
      }

      return "";
    })
    .filter(Boolean);

const resolveUserPermissions = async (user) => {
  const roleDoc = await findRoleForUser(user);

  const rolePermissions = Array.isArray(roleDoc?.permissions)
    ? extractPermissionKeys(roleDoc.permissions)
    : [];

  const directPermissions = Array.isArray(user?.permissions)
    ? extractPermissionKeys(user.permissions)
    : [];

  const effectivePermissions = roleDoc
    ? normalizePermissions(rolePermissions)
    : normalizePermissions(directPermissions);

  const normalizedRole = String(user?.role || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

  if (normalizedRole === "ACCOUNTANT") {
    return {
      roleDoc,
      permissions: normalizePermissions([
        ...effectivePermissions,
        "ACCESS_FINANCE",
        "VIEW_INVOICE",
        "VIEW_EXPENSE",
      ]),
    };
  }

  return {
    roleDoc,
    permissions: effectivePermissions,
  };
};

module.exports = {
  normalizePermissions,
  resolveUserPermissions,
};
