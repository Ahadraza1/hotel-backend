const express = require("express");
const router = express.Router();

const auditController = require("./audit.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  Get Audit Logs
*/
router.get(
  "/",
  requireAuth,
  requirePermission("VIEW_AUDIT_LOGS"),
  auditController.getAuditLogs
);

module.exports = router;