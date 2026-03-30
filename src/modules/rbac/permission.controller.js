const mongoose = require("mongoose");
const Permission = require("./permission.model");
const Role = require("./role.model");

const canManagePermissions = (user) => user?.role === "SUPER_ADMIN";

const normalizeToken = (value) => String(value || "").trim().toUpperCase();

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

    const rawName = String(req.body?.name || "").trim();
    const name = rawName;
    const normalizedName = normalizeToken(rawName);
    const key = normalizeToken(req.body?.key);
    const module = normalizeToken(req.body?.module);
    const description = String(req.body?.description || "").trim();

    if (!name || !key || !module) {
      return res.status(400).json({
        success: false,
        message: "Name, key, and module are required",
      });
    }

    const existingPermission = await Permission.findOne({
      $or: [{ key }, { key: normalizedName }, { name }, { name: rawName }],
    }).lean();

    if (existingPermission) {
      return res.status(409).json({
        success: false,
        message:
          existingPermission.key === key
            ? "Permission key already exists"
            : "Permission name already exists",
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

    if (error?.name === "ValidationError" || error?.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: error.message || "Invalid permission payload",
      });
    }

    console.error("Failed to create permission", {
      body: req.body,
      error: error?.message,
      stack: error?.stack,
    });

    return res.status(500).json({
      success: false,
      message: "Failed to create permission",
    });
  }
};

exports.deletePermission = async (req, res) => {
  try {
    if (!canManagePermissions(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const { permissionId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(permissionId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid permissionId",
      });
    }

    const permission = await Permission.findById(permissionId);

    if (!permission) {
      return res.status(404).json({
        success: false,
        message: "Permission not found",
      });
    }

    await Role.updateMany(
      { permissions: permission._id },
      { $pull: { permissions: permission._id } },
    );

    await Permission.findByIdAndDelete(permission._id);

    return res.status(200).json({
      success: true,
      message: "Permission deleted successfully",
    });
  } catch (error) {
    console.error("Failed to delete permission", {
      permissionId: req.params?.permissionId,
      error: error?.message,
      stack: error?.stack,
    });

    return res.status(500).json({
      success: false,
      message: "Failed to delete permission",
    });
  }
};
