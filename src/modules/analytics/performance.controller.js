const performanceService = require("./performance.service");
const asyncHandler = require("../../utils/asyncHandler");

/*
  Corporate Performance Dashboard
  GET /analytics/performance?year=2026&month=5
*/
exports.getCorporatePerformance = asyncHandler(async (req, res) => {

  const { year, month } = req.query;

  const data = await performanceService.getCorporatePerformance(
    req.user,
    year ? Number(year) : null,
    month ? Number(month) : null
  );

  return res.status(200).json({
    success: true,
    data,
  });
});