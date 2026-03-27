const requireBranchManager = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.user.role !== "BRANCH_MANAGER") {
    return res.status(403).json({
      message: "Access denied - Branch Manager only",
    });
  }

  next();
};

module.exports = requireBranchManager;
