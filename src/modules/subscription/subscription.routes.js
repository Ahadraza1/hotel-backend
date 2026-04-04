const express = require("express");
const router = express.Router();

const requireAuth = require("../../middleware/requireAuth.middleware");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");
const requireCorporateAdmin = require("../../middleware/requireCorporateAdmin.middleware");
const authorize = require("../../middleware/authorize.middleware");
const subscriptionController = require("./subscription.controller");
const auditMiddleware = require("../audit/audit.middleware");

router.get(
  "/dashboard",
  requireAuth,
  authorize("SUPER_ADMIN", "CORPORATE_ADMIN"),
  subscriptionController.getDashboard,
);
router.get(
  "/plans",
  requireAuth,
  authorize("SUPER_ADMIN", "CORPORATE_ADMIN"),
  subscriptionController.getPlans,
);
router.get(
  "/organizations",
  requireAuth,
  authorize("SUPER_ADMIN", "CORPORATE_ADMIN"),
  subscriptionController.getOrganizations,
);
router.get(
  "/branch-eligibility",
  requireAuth,
  authorize("SUPER_ADMIN", "CORPORATE_ADMIN"),
  subscriptionController.getBranchEligibility,
);

router.post(
  "/plans",
  requireAuth,
  requireSuperAdmin,
  auditMiddleware("CREATE_PLAN", "SUBSCRIPTION", "Created subscription plan"),
  subscriptionController.createPlan,
);

router.put(
  "/plans/:planId",
  requireAuth,
  requireSuperAdmin,
  auditMiddleware("UPDATE_PLAN", "SUBSCRIPTION", "Updated subscription plan"),
  subscriptionController.updatePlan,
);

router.delete(
  "/plans/:planId",
  requireAuth,
  requireSuperAdmin,
  auditMiddleware("DELETE_PLAN", "SUBSCRIPTION", "Deleted subscription plan"),
  subscriptionController.deletePlan,
);

router.post(
  "/organizations/:organizationId/assign",
  requireAuth,
  requireSuperAdmin,
  auditMiddleware("ASSIGN_PLAN", "SUBSCRIPTION", "Assigned subscription plan"),
  subscriptionController.assignPlan,
);

router.post(
  "/organizations/:organizationId/cancel",
  requireAuth,
  requireSuperAdmin,
  auditMiddleware(
    "CANCEL_PLAN",
    "SUBSCRIPTION",
    "Cancelled organization subscription",
  ),
  subscriptionController.cancelOrganizationPlan,
);

router.post(
  "/checkout/order",
  requireAuth,
  requireCorporateAdmin,
  subscriptionController.createCheckoutOrder,
);

router.post(
  "/checkout/verify",
  requireAuth,
  requireCorporateAdmin,
  subscriptionController.verifyCheckout,
);

module.exports = router;
