const express = require("express");
const router = express.Router();

const housekeepingController = require("./housekeeping.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  ===========================
  HOUSEKEEPING TASK ROUTES
  ===========================
*/

/*
  Create Task
  POST /housekeeping
*/
router.post(
  "/",
  requireAuth,
  requirePermission("ACCESS_HOUSEKEEPING"),
  housekeepingController.createTask
);

/*
  Get Tasks
  GET /housekeeping
*/
router.get(
  "/",
  requireAuth,
  requirePermission(["ACCESS_HOUSEKEEPING", "VIEW_TASK"]),
  housekeepingController.getTasks
);

/*
  Assign Task
  PATCH /housekeeping/:taskId/assign
*/
router.patch(
  "/:taskId/assign",
  requireAuth,
  requirePermission("ACCESS_HOUSEKEEPING"),
  housekeepingController.assignTask
);

/*
  Update Status
  PATCH /housekeeping/:taskId/status
*/
router.patch(
  "/:taskId/status",
  requireAuth,
  requirePermission("ACCESS_HOUSEKEEPING"),
  housekeepingController.updateStatus
);

/*
  Deactivate Task
  PATCH /housekeeping/:taskId/deactivate
*/
router.patch(
  "/:taskId/deactivate",
  requireAuth,
  requirePermission("ACCESS_HOUSEKEEPING"),
  housekeepingController.deactivateTask
);

module.exports = router;
