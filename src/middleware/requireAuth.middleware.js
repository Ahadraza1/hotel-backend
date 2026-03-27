const jwt = require("jsonwebtoken");
const Organization = require("../modules/organization/organization.model");
const subscriptionService = require("../modules/subscription/subscription.service");

const isSubscriptionBypassRoute = (req) => {
  const path = String(req.originalUrl || req.url || "");

  return (
    path.startsWith("/api/auth/me") ||
    path.startsWith("/api/users/me") ||
    path.startsWith("/api/subscriptions/dashboard") ||
    path.startsWith("/api/subscriptions/plans") ||
    path.startsWith("/api/subscriptions/checkout/order") ||
    path.startsWith("/api/subscriptions/checkout/verify") ||
    path.startsWith("/api/subscriptions/branch-eligibility")
  );
};

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Unauthorized - No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "Server configuration error",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ IMPORTANT FIX: Attach _id properly
    // 🔥 Get active branch from header
    const headerBranchId =
      req.headers["x-branch-id"] || req.get("x-branch-id") || null;

    console.log("Header branch:", headerBranchId);
    // console.log("DECODED TOKEN:", decoded);

    // ✅ Attach user with dynamic branch
    const activeBranchId = req.headers["x-branch-id"] || decoded.branchId;

    req.user = {
      _id: decoded.userId || decoded.id,
      id: decoded.userId || decoded.id,
      userId: decoded.userId || decoded.id,
      role: decoded.role
        ? decoded.role.toUpperCase().replace(/\s+/g, "_")
        : null,
      permissions: decoded.permissions || [],
      organizationId: decoded.organizationId || null,
      branchId: activeBranchId || null,
      isPlatformAdmin: decoded.isPlatformAdmin || false,
    };

    // 🔒 SUPER ADMIN bypass
    if (req.user.isPlatformAdmin) {
      return next();
    }

    // 🔒 ORGANIZATION BLOCK CHECK
    if (req.user.organizationId) {
      const organization = await Organization.findOne(
        { organizationId: req.user.organizationId },
        { isBlocked: 1 },
      ).lean();

      if (organization?.isBlocked) {
        return res.status(403).json({
          message:
            "Your organization has been blocked by Super Admin. Access denied.",
        });
      }

      const subscriptionAccess =
        await subscriptionService.getSubscriptionAccessForOrganization(
          req.user.organizationId,
        );

      req.user.subscriptionAccess = subscriptionAccess;

      if (
        subscriptionAccess &&
        !subscriptionAccess.hasDashboardAccess &&
        !isSubscriptionBypassRoute(req)
      ) {
        return res.status(403).json({
          code: "SUBSCRIPTION_INACTIVE",
          message:
            subscriptionAccess.restrictionReason ||
            "Your subscription is inactive. Please renew or upgrade.",
          subscription: subscriptionAccess,
        });
      }
    }

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Unauthorized - Token expired",
      });
    }

    return res.status(401).json({
      message: "Unauthorized - Invalid token",
    });
  }
};

module.exports = requireAuth;
