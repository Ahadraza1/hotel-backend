module.exports = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized - No user context",
      });
    }

    const { role, isPlatformAdmin } = req.user;

    // 🔥 Platform Admin Bypass (Optional Super Override)
    if (isPlatformAdmin) {
      return next();
    }

    // 🔥 If no specific roles passed → allow any authenticated user
    if (!allowedRoles || allowedRoles.length === 0) {
      return next();
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        message: "Access Denied - Insufficient Role",
      });
    }

    next();
  };
};