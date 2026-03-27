const AuditLog = require("./audit.model");

exports.logAction = async ({
  user,
  action,
  message,
  module,
  metadata,
  req,
}) => {

  if (!user) return;

  await AuditLog.create({
    userId: user.userId,
    role: user.role,
    organizationId: user.organizationId,
    branchId: user.branchId,
    action,
    message: message || "",
    module,
    metadata: metadata || {},
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
};


/*
  Get Logs (Role-based)
*/
exports.getLogs = async (user) => {

  let filter = {};

  if (user.role === "SUPER_ADMIN") {
    filter = {};
  }
  else if (user.role === "CORPORATE_ADMIN") {
    filter.organizationId = user.organizationId;
  }
  else {
    throw new Error("Access denied");
  }

  return await AuditLog.find(filter).sort({ createdAt: -1 });
};
