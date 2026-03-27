const express = require("express");
const router = express.Router();

const financialReportsController = require("./financialReports.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

router.get(
  "/overview",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  financialReportsController.getOverview,
);

router.get(
  "/monthly-revenue",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  financialReportsController.getMonthlyRevenue,
);

router.get(
  "/plan-distribution",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  financialReportsController.getPlanDistribution,
);

router.get(
  "/recent-payments",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  financialReportsController.getRecentPayments,
);

module.exports = router;
