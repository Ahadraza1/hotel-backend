const express = require("express");

const roomTypeController = require("./roomType.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
const requireBranchAccess = require("../../middleware/requireBranchAccess.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

const router = express.Router();

router.get(
  "/",
  requireAuth,
  requireBranchAccess,
  requirePermission(["ACCESS_ROOMS", "VIEW_ROOM"]),
  roomTypeController.getRoomTypes,
);

router.post(
  "/",
  requireAuth,
  requireBranchAccess,
  requirePermission("CREATE_ROOM"),
  roomTypeController.createRoomType,
);

router.put(
  "/:roomTypeId",
  requireAuth,
  requireBranchAccess,
  requirePermission("UPDATE_ROOM"),
  roomTypeController.updateRoomType,
);

router.delete(
  "/:roomTypeId",
  requireAuth,
  requireBranchAccess,
  requirePermission("UPDATE_ROOM"),
  roomTypeController.deleteRoomType,
);

module.exports = router;
