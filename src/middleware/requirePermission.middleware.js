const Role = require("../modules/rbac/role.model");

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
      const roleQuery = req.user.roleRef
        ? { _id: req.user.roleRef }
        : { normalizedName: role };
      const roleDoc = await Role.findOne(roleQuery).populate(
        "permissions",
        "name key",
      );

      const userPermissions = Array.isArray(roleDoc?.permissions)
        ? roleDoc.permissions.map((permission) =>
            (permission.key || permission.name).trim().toUpperCase(),
          )
        : [];

      req.user.permissions = userPermissions;

      const requiredPermission = permissionName?.trim().toUpperCase();

      if (!userPermissions.includes(requiredPermission)) {
        return res.status(403).json({
          message: `Missing permission: ${requiredPermission}`,
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
