const express = require("express");
const router = express.Router();

const systemSettingsController = require("./systemSettings.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");

/*
  Get System Settings
*/
router.get(
  "/",
  requireAuth,
  requireSuperAdmin,
  systemSettingsController.getSystemSettings
);

/*
  Update System Settings
*/
router.put(
  "/",
  requireAuth,
  requireSuperAdmin,
  systemSettingsController.updateSystemSettings
);

module.exports = router;
