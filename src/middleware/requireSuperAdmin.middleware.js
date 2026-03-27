const requireSuperAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ message: "Access denied - Super Admin only" });
  }

  next();
};

module.exports = requireSuperAdmin;
