const express = require("express");
const router = express.Router();

const systemSettingsController = require("./systemSettings.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  Get System Settings
*/
router.get(
  "/",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"), // you can change permission later
  systemSettingsController.getSystemSettings
);

/*
  Update System Settings
*/
router.put(
  "/",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  systemSettingsController.updateSystemSettings
);

module.exports = router;