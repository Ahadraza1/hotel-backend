const Role = require("../modules/role/role.model");

const checkPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const role = await Role.findById(req.user.roleId).populate("permissions");

      if (!role) {
        return res.status(404).json({ message: "Role not found" });
      }

      const hasPermission = role.permissions.some(
        (perm) => perm.name === requiredPermission
      );

      if (!hasPermission) {
        return res.status(403).json({ message: "Access denied" });
      }

      next();
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  };
};

module.exports = checkPermission;
