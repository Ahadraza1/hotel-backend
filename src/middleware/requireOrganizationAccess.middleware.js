const { ensureActiveOrganization } = require("../utils/workspaceScope");

const requireOrganizationAccess = (req, res, next) => {
  (async () => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (req.user.role === "SUPER_ADMIN") {
      return next();
    }

    if (!req.user.organizationId) {
      return res.status(403).json({ message: "Organization access denied" });
    }

    const organization = await ensureActiveOrganization(req.user.organizationId);

    if (!organization) {
      return res.status(403).json({ message: "Organization access denied" });
    }

    req.organization = organization;
    next();
  })().catch(() =>
    res.status(500).json({ message: "Failed to validate organization access" }),
  );
};

module.exports = requireOrganizationAccess;
