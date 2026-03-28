const { ensureActiveBranch } = require("../utils/workspaceScope");

const requireBranchAccess = (req, res, next) => {
  (async () => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userRole = req.user.role?.toUpperCase();

    if (userRole === "SUPER_ADMIN") {
      return next();
    }

    const headerBranchId = req.headers["x-branch-id"];
    const userBranchId = req.user.branchId;

    if (!userBranchId) {
      return res.status(403).json({ message: "Branch access denied" });
    }

    if (headerBranchId && headerBranchId !== String(userBranchId)) {
      return res.status(403).json({
        message: "You do not have access to this branch",
      });
    }

    const branchId = headerBranchId || userBranchId;
    const branch = await ensureActiveBranch(branchId);

    if (!branch) {
      return res.status(403).json({ message: "Branch access denied" });
    }

    req.branchId = branchId;
    req.branch = branch;
    next();
  })().catch(() =>
    res.status(500).json({ message: "Failed to validate branch access" }),
  );
};

module.exports = requireBranchAccess;
