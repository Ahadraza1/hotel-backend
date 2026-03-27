const express = require("express");
const router = express.Router();

const securityController = require("./security.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  Security Overview
*/
router.get(
  "/overview",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  securityController.getOverview
);

/*
  Login History
*/
router.get(
  "/login-history",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  securityController.getLoginHistory
);

/*
  Audit Logs
*/
router.get(
  "/audit-logs",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  securityController.getAuditLogs
);

module.exports = router;