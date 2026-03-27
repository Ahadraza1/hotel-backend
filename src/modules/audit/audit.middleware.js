const auditService = require("./audit.service");

const auditMiddleware = (action, module, message) => {
  return async (req, res, next) => {

    res.on("finish", async () => {
      if (res.statusCode < 400) {
        await auditService.logAction({
          user: req.user,
          action,
          message,
          module,
          metadata: req.body,
          req,
        });
      }
    });

    next();
  };
};

module.exports = auditMiddleware;
