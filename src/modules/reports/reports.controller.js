const asyncHandler = require("../../utils/asyncHandler");
const reportsService = require("./reports.service");

const buildPayload = (req) => {
  const { branchId, startDate, endDate } = req.query;

  if (!branchId) {
    const error = new Error("Branch id is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    user: req.user,
    branchId,
    startDate,
    endDate,
  };
};

const sendReport = (serviceMethod) =>
  asyncHandler(async (req, res) => {
    try {
      const data = await serviceMethod(buildPayload(req));

      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      return res.status(error.statusCode || 400).json({
        success: false,
        code: error.code || "REPORT_ERROR",
        message: error.message || "Failed to load report",
      });
    }
  });

exports.getRoomsReport = sendReport(reportsService.getRoomsReport);
exports.getRestaurantReport = sendReport(reportsService.getRestaurantReport);
exports.getHousekeepingReport = sendReport(reportsService.getHousekeepingReport);
exports.getCrmReport = sendReport(reportsService.getCrmReport);
