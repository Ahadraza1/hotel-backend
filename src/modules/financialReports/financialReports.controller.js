const financialReportsService = require("./financialReports.service");

exports.getOverview = async (req, res) => {
  try {
    const data = await financialReportsService.getOverview(req.user);
    res.status(200).json({ data });
  } catch (error) {
    res.status(403).json({ message: error.message });
  }
};

exports.getMonthlyRevenue = async (req, res) => {
  try {
    const data = await financialReportsService.getMonthlyRevenue(req.user);
    res.status(200).json({ data });
  } catch (error) {
    res.status(403).json({ message: error.message });
  }
};

exports.getPlanDistribution = async (req, res) => {
  try {
    const data = await financialReportsService.getPlanDistribution(req.user);
    res.status(200).json({ data });
  } catch (error) {
    res.status(403).json({ message: error.message });
  }
};

exports.getRecentPayments = async (req, res) => {
  try {
    const data = await financialReportsService.getRecentPayments(req.user);
    res.status(200).json({ data });
  } catch (error) {
    res.status(403).json({ message: error.message });
  }
};
