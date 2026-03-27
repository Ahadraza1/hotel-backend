const express = require("express");
const router = express.Router();

const integrationsController = require("./integrations.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  Get All Integrations
*/
router.get(
  "/",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  integrationsController.getIntegrations
);

module.exports = router;