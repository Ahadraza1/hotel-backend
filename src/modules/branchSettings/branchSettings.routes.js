const express = require("express");
const router = express.Router();

const branchSettingsController = require("./branchSettings.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  ===========================
  BRANCH SETTINGS ROUTES
  ===========================
*/

/*
  Get Branch Settings
  GET /branch-settings/:branchId
*/
router.get(
  "/:branchId",
  requireAuth,
  requirePermission("ACCESS_BRANCH_SETTINGS"),
  branchSettingsController.getSettings
);

/*
  Update Full Branch Settings
  PUT /branch-settings/:branchId
*/
router.put(
  "/:branchId",
  requireAuth,
  requirePermission("ACCESS_BRANCH_SETTINGS"),
  branchSettingsController.updateSettings
);

/*
  Update Specific Section
  PATCH /branch-settings/:branchId/:section
  Example:
  PATCH /branch-settings/123/financial
*/
router.patch(
  "/:branchId/:section",
  requireAuth,
  requirePermission("ACCESS_BRANCH_SETTINGS"),
  branchSettingsController.updateSection
);

/*
  Reset Branch Settings
  DELETE /branch-settings/:branchId/reset
*/
router.delete(
  "/:branchId/reset",
  requireAuth,
  requirePermission("ACCESS_BRANCH_SETTINGS"),
  branchSettingsController.resetSettings
);

module.exports = router;