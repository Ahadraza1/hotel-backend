const Permission = require("./permission.model");

const canManagePermissions = (user) =>
  ["SUPER_ADMIN", "CORPORATE_ADMIN"].includes(user?.role);

/*
  Get Permissions
*/
exports.getPermissions = async (req, res) => {
  try {
    if (!canManagePermissions(req.user)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    if (req.user?.role === "CORPORATE_ADMIN" && !req.user.organizationId) {
      return res.status(403).json({
        message: "Organization access is required",
      });
    }

    const permissions = await Permission.find().sort({ module: 1, key: 1 });

    const grouped = permissions.reduce((acc, perm) => {
      const category = perm.module || "GENERAL";

      if (!acc[category]) {
        acc[category] = [];
      }

      acc[category].push({
        _id: perm._id,
        name: perm.name,
        key: perm.key || perm.name,
        module: perm.module,
        description: perm.description || "",
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

exports.createPermission = async (req, res) => {
  try {
    if (!canManagePermissions(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const name = String(req.body?.name || "").trim();
    const key = String(req.body?.key || "").trim().toUpperCase();
    const module = String(req.body?.module || "").trim().toUpperCase();
    const description = String(req.body?.description || "").trim();

    if (!name || !key || !module) {
      return res.status(400).json({
        success: false,
        message: "Name, key, and module are required",
      });
    }

    const existingPermission = await Permission.findOne({
      $or: [{ key }, { name: key }],
    }).lean();

    if (existingPermission) {
      return res.status(409).json({
        success: false,
        message: "Permission key already exists",
      });
    }

    const permission = await Permission.create({
      name,
      key,
      module,
      description,
    });

    return res.status(201).json({
      success: true,
      message: "Permission created successfully",
      data: permission,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Permission key already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create permission",
    });
  }
};
