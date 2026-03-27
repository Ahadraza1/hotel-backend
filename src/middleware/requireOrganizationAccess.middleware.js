const requireOrganizationAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Super Admin bypass
  if (req.user.role === "SUPER_ADMIN") {
    return next();
  }

  if (!req.user.organizationId) {
    return res.status(403).json({ message: "Organization access denied" });
  }

  next();
};

module.exports = requireOrganizationAccess;
