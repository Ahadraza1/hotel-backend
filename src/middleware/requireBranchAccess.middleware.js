const requireBranchAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const userRole = req.user.role?.toUpperCase();

  // Super admin bypass
  if (userRole === "SUPER_ADMIN") {
    return next();
  }

  const headerBranchId = req.headers["x-branch-id"];
  const userBranchId = req.user.branchId;

  /*
  If user has no branch assigned
  */
  if (!userBranchId) {
    return res.status(403).json({ message: "Branch access denied" });
  }

  /*
  Branch users can only access their own branch
  */
  if (headerBranchId && headerBranchId !== String(userBranchId)) {
    return res.status(403).json({
      message: "You do not have access to this branch",
    });
  }

  /*
  Attach branch to request for controllers
  */
  req.branchId = headerBranchId || userBranchId;

  next();
};

module.exports = requireBranchAccess;