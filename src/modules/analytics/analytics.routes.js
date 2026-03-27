const express = require("express");
const router = express.Router();

const analyticsController = require("./analytics.controller");
const performanceController = require("./performance.controller"); // ✅ ADDED

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  ===========================
  CORE ANALYTICS METRICS
  ===========================
*/

/*
  GET /analytics/occupancy
*/
router.get(
  "/occupancy",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  analyticsController.getOccupancyRate
);

/*
  GET /analytics/adr
*/
router.get(
  "/adr",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  analyticsController.getADR
);

/*
  GET /analytics/revpar
*/
router.get(
  "/revpar",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  analyticsController.getRevPAR
);

/*
  GET /analytics/financial
*/
router.get(
  "/financial",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  analyticsController.getFinancialOverview
);


/*
  ===========================
  CORPORATE DASHBOARD
  ===========================
*/

/*
  GET /analytics/corporate/dashboard
*/
router.get(
  "/corporate/dashboard",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  analyticsController.getCorporateDashboard
);

/*
  GET /analytics/performance   ✅ NEW ENTERPRISE ROUTE
*/
router.get(
  "/performance",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  performanceController.getCorporatePerformance
);


/*
  ===========================
  BRANCH DASHBOARD
  ===========================
*/

/*
  GET /analytics/branch-dashboard
  Accessible to all authenticated branch users
*/
router.get(
  "/branch-dashboard",
  requireAuth,
  analyticsController.getBranchDashboard
);
/*
  ===========================
  ADVANCED ANALYTICS (Charts)
  ===========================
*/

/*
  GET /analytics/revenue-by-branch
*/
router.get(
  "/revenue-by-branch",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  analyticsController.getRevenueByBranch
);

/*
  GET /analytics/occupancy-trend
*/
router.get(
  "/occupancy-trend",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  analyticsController.getOccupancyTrend
);

/*
  GET /analytics/revpar-trend
*/
router.get(
  "/revpar-trend",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  analyticsController.getRevPARTrend
);

/*
  ===========================
  BRANCH REVENUE CHARTS
  ===========================
*/

/*
  GET /analytics/room-revenue-chart
*/
router.get(
  "/room-revenue-chart",
  requireAuth,
  analyticsController.getRoomRevenueChart
);

/*
  GET /analytics/restaurant-revenue-chart
*/
router.get(
  "/restaurant-revenue-chart",
  requireAuth,
  analyticsController.getRestaurantRevenueChart
);

module.exports = router;