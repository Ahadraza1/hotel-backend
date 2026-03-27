const analyticsService = require("./analytics.service");
const asyncHandler = require("../../utils/asyncHandler");

/*
  ===========================
  CORE METRICS
  ===========================
*/

/*
  Occupancy Rate
*/
exports.getOccupancyRate = asyncHandler(async (req, res) => {

  const data = await analyticsService.getOccupancyRate(req.user);

  return res.status(200).json({
    success: true,
    data,
  });
});


/*
  ADR
*/
exports.getADR = asyncHandler(async (req, res) => {

  const data = await analyticsService.getADR(req.user);

  return res.status(200).json({
    success: true,
    data,
  });
});


/*
  RevPAR
*/
exports.getRevPAR = asyncHandler(async (req, res) => {

  const data = await analyticsService.getRevPAR(req.user);

  return res.status(200).json({
    success: true,
    data,
  });
});


/*
  Financial Overview
*/
exports.getFinancialOverview = asyncHandler(async (req, res) => {

  const data = await analyticsService.getFinancialOverview(req.user);

  return res.status(200).json({
    success: true,
    data,
  });
});


/*
  ===========================
  CORPORATE DASHBOARD
  ===========================
*/

/*
  Corporate Consolidated Dashboard
  SUPER_ADMIN → All organizations
  CORPORATE_ADMIN → Only their organization
*/
exports.getCorporateDashboard = asyncHandler(async (req, res) => {

  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  const data = await analyticsService.getCorporateDashboard(req.user);

  return res.status(200).json({
    success: true,
    data,
  });
});


/*
  Branch Dashboard
  BRANCH_MANAGER → Only their branch
*/
exports.getBranchDashboard = asyncHandler(async (req, res) => {

  const branchId = req.query.branchId;

  if (!branchId) {
    return res.status(400).json({
      success: false,
      message: "Branch context required",
    });
  }

  /*
    SECURITY: Branch managers cannot request other branches
  */
  if (
    req.user.role === "BRANCH_MANAGER" &&
    req.user.branchId?.toString() !== branchId
  ) {
    return res.status(403).json({
      success: false,
      message: "Access denied to this branch",
    });
  }

  const data = await analyticsService.getBranchDashboard(
    req.user,
    branchId
  );

  return res.status(200).json({
    success: true,
    data,
  });
});


/*
  ===========================
  ADVANCED CHART ANALYTICS
  ===========================
*/

/*
  Revenue by Branch (Corporate Chart)
*/
exports.getRevenueByBranch = asyncHandler(async (req, res) => {

  const { view, year, month } = req.query;

  const data = await analyticsService.getRevenueByBranch(req.user, view, year, month);

  return res.status(200).json({
    success: true,
    data,
  });
});


/*
  Occupancy Trend (Time Series)
*/
exports.getOccupancyTrend = asyncHandler(async (req, res) => {

  const data = await analyticsService.getOccupancyTrend(req.user, req.query.year);

  return res.status(200).json({
    success: true,
    data,
  });
});

/*
  RevPAR Trend (Time Series)
*/
exports.getRevPARTrend = asyncHandler(async (req, res) => {

  const data = await analyticsService.getRevPARTrend(req.user, req.query.year);

  return res.status(200).json({
    success: true,
    data,
  });
});

/*
  ===========================
  BRANCH REVENUE CHARTS
  ===========================
*/

/*
  Room Revenue Chart
*/
exports.getRoomRevenueChart = asyncHandler(async (req, res) => {

  const { branchId, view, year, quarter } = req.query;

  if (!branchId) {
    return res.status(400).json({
      success: false,
      message: "Branch context required",
    });
  }

  const data = await analyticsService.getRoomRevenueChart({
    user: req.user,
    branchId,
    view,
    year,
    quarter
  });

  return res.status(200).json({
    success: true,
    data,
  });
});


/*
  Restaurant Revenue Chart
*/
exports.getRestaurantRevenueChart = asyncHandler(async (req, res) => {

  const { branchId, view, year, quarter } = req.query;

  if (!branchId) {
    return res.status(400).json({
      success: false,
      message: "Branch context required",
    });
  }

  const data = await analyticsService.getRestaurantRevenueChart({
    user: req.user,
    branchId,
    view,
    year,
    quarter
  });

  return res.status(200).json({
    success: true,
    data,
  });
});
