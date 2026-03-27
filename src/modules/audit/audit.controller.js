const auditService = require("./audit.service");

/*
  Get Audit Logs
*/
exports.getAuditLogs = async (req, res) => {
  try {
    const logs = await auditService.getLogs(req.user);

    res.status(200).json({
      count: logs.length,
      data: logs,
    });

  } catch (error) {
    res.status(403).json({
      message: error.message,
    });
  }
};
