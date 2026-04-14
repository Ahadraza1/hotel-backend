const Organization = require("../modules/organization/organization.model");

/**
 * Middleware to check if an organization has access to a specific feature flag
 * defined by their subscription plan.
 * 
 * @param {string} feature - The feature flag to check (e.g., 'ROOM_MANAGEMENT', 'INVENTORY')
 */
const requireFeatureFlag = (feature) => {
  return async (req, res, next) => {
    try {
      const { user } = req;

      if (!user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Super admins bypassing feature flag checks for management purposes
      if (user.role === "SUPER_ADMIN") {
        return next();
      }

      if (!user.organizationId) {
        return res.status(403).json({ message: "Organization access required" });
      }

      const organization = await Organization.findOne({ organizationId: user.organizationId }).lean();

      if (!organization) {
        return res.status(404).json({ message: "Organization not found" });
      }

      if (!organization.featureFlags || !organization.featureFlags.includes(feature)) {
        return res.status(403).json({
          message: "Locked Module",
          description: "This feature is not included in your current subscription plan. Please upgrade to gain access.",
          requiredFeature: feature,
          isLocked: true
        });
      }

      next();
    } catch (error) {
      console.error(`Feature flag check error: ${error.message}`);
      res.status(500).json({ message: "Internal server error during feature validation" });
    }
  };
};

module.exports = {
  requireFeatureFlag
};
