const { resolveUserPermissions } = require("../utils/resolveUserPermissions");

const requirePermission = (permissionName) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const role = req.user.role?.toUpperCase();

    if (req.user.isPlatformAdmin || role === "SUPER_ADMIN") {
      return next();
    }

    try {
      const { permissions: resolvedPermissions } = await resolveUserPermissions(
        req.user,
      );

      req.user.permissions = resolvedPermissions;

      const requiredPermissions = Array.isArray(permissionName)
        ? permissionName
            .filter((permission) => typeof permission === "string")
            .map((permission) => permission.trim().toUpperCase())
            .filter(Boolean)
        : [permissionName?.trim().toUpperCase()].filter(Boolean);

      const missingPermissions = requiredPermissions.filter(
        (permission) => !resolvedPermissions.includes(permission),
      );

      if (missingPermissions.length > 0) {
        return res.status(403).json({
          message: `Missing permission: ${missingPermissions.join(", ")}`,
        });
      }

      return next();
    } catch (error) {
      return res.status(500).json({
        message: "Failed to validate permissions",
      });
    }
  };
};

module.exports = requirePermission;
