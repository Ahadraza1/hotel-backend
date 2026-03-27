const requireCorporateAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.user.role !== "CORPORATE_ADMIN") {
    return res.status(403).json({
      message: "Access denied - Corporate Admin only",
    });
  }

  next();
};

module.exports = requireCorporateAdmin;
