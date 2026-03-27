const Permission = require("./permission.model");

/*
  Get Permissions
*/
exports.getPermissions = async (req, res) => {
  try {
    if (!["SUPER_ADMIN", "CORPORATE_ADMIN"].includes(req.user?.role)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    if (req.user?.role === "CORPORATE_ADMIN" && !req.user.organizationId) {
      return res.status(403).json({
        message: "Organization access is required",
      });
    }

    const permissions = await Permission.find().sort({ category: 1 });

    // 🔥 Group permissions by module
    const grouped = permissions.reduce((acc, perm) => {
      const category = perm.module || "GENERAL";

      if (!acc[category]) {
        acc[category] = [];
      }

      acc[category].push({
        _id: perm._id,
        name: perm.name,
      });

      return acc;
    }, {});

    const formatted = Object.keys(grouped).map((cat) => ({
      category: cat,
      permissions: grouped[cat],
    }));

    res.status(200).json({
      count: formatted.length,
      data: formatted,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch permissions",
    });
  }
};
