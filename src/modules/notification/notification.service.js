const Notification = require("./notification.model");
const Role = require("../rbac/role.model");
const {
  ensureActiveBranch,
  ensureActiveOrganization,
} = require("../../utils/workspaceScope");

const SUPERADMIN_ROLES = new Set(["SUPER_ADMIN", "SUPERADMIN"]);

const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");

const normalizeIdentifier = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return String(value);
};

const normalizeModule = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const isSuperAdminUser = (user = {}) =>
  Boolean(user?.isPlatformAdmin) || SUPERADMIN_ROLES.has(normalizeRole(user.role));

const getAllowedModulesForUser = async (user = {}) => {
  if (isSuperAdminUser(user)) {
    return null;
  }

  const roleName = normalizeRole(user.role);

  if (!roleName) {
    return [];
  }

  const roleDoc = await Role.findOne({ name: roleName }).populate(
    "permissions",
    "module",
  );

  if (!roleDoc || !Array.isArray(roleDoc.permissions)) {
    return [];
  }

  return [
    ...new Set(
      roleDoc.permissions
        .map((permission) => normalizeModule(permission?.module))
        .filter(Boolean),
    ),
  ];
};

const buildNotificationQueryForUser = async (user = {}) => {
  const query = {};
  const role = normalizeRole(user.role);

  if (!isSuperAdminUser(user)) {
    if (role === "CORPORATE_ADMIN") {
      const organizationId = normalizeIdentifier(user.organizationId);
      if (!organizationId) {
        return null;
      }
      if (!(await ensureActiveOrganization(organizationId))) {
        return null;
      }
      query.organizationId = organizationId;
    } else if (role === "BRANCH_MANAGER") {
      const branchId = normalizeIdentifier(user.branchId);
      if (!branchId) {
        return null;
      }
      if (!(await ensureActiveBranch(branchId))) {
        return null;
      }
      query.branchId = branchId;
    } else if (user.branchId) {
      const branchId = normalizeIdentifier(user.branchId);
      if (!branchId) {
        return null;
      }
      if (!(await ensureActiveBranch(branchId))) {
        return null;
      }
      query.branchId = branchId;
    } else if (user.organizationId) {
      const organizationId = normalizeIdentifier(user.organizationId);
      if (!organizationId) {
        return null;
      }
      if (!(await ensureActiveOrganization(organizationId))) {
        return null;
      }
      query.organizationId = organizationId;
    }

    const allowedModules = await getAllowedModulesForUser(user);

    if (!allowedModules || allowedModules.length === 0) {
      return null;
    }

    query.module = { $in: allowedModules };
  }

  return query;
};

exports.createNotification = async (payload = {}) => {
  const notificationData = {
    title: String(payload.title || "").trim(),
    message: String(payload.message || "").trim(),
    type: String(payload.type || "system")
      .trim()
      .toLowerCase(),
    organizationId: normalizeIdentifier(payload.organizationId),
    branchId: normalizeIdentifier(payload.branchId),
    module: normalizeModule(payload.module),
    createdAt: payload.createdAt || new Date(),
  };

  if (
    !notificationData.title ||
    !notificationData.message ||
    !notificationData.module
  ) {
    throw new Error("Invalid notification payload");
  }

  return Notification.create(notificationData);
};

exports.createNotificationSafely = async (payload = {}) => {
  try {
    return await exports.createNotification(payload);
  } catch (error) {
    console.error("Notification creation failed:", error.message);
    return null;
  }
};

exports.getNotificationsForUser = async (user = {}, options = {}) => {
  const query = await buildNotificationQueryForUser(user);

  if (query === null) {
    return { notifications: [], total: 0 };
  }

  const parsedLimit = Number(options.limit);
  const hasLimit = Number.isFinite(parsedLimit) && parsedLimit > 0;

  const [notifications, total] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(hasLimit ? parsedLimit : 0)
      .lean(),
    Notification.countDocuments(query),
  ]);

  return { notifications, total };
};
