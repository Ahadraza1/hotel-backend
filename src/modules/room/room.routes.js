const express = require("express");
const router = express.Router();

const roomController = require("./room.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");
const auditMiddleware = require("../audit/audit.middleware");

/*
  Create Room
*/
router.post(
  "/",
  requireAuth,
  requirePermission("CREATE_ROOM"),
  roomController.createRoom
);

/*
  Get Rooms
*/
router.get(
  "/",
  requireAuth,
  requirePermission(["ACCESS_ROOMS", "VIEW_ROOM"]),
  roomController.getRooms
);

/*
  Update Room
*/
router.put(
  "/:roomId",
  requireAuth,
  requirePermission("UPDATE_ROOM"),
  auditMiddleware("UPDATE_ROOM", "ROOM", "Updated room"),
  roomController.updateRoom
);

/*
  Change Room Status
*/
router.patch(
  "/:roomId/status",
  requireAuth,
  requirePermission("UPDATE_ROOM"),
  auditMiddleware("UPDATE_ROOM_STATUS", "ROOM", "Updated room status"),
  roomController.changeRoomStatus
);

/*
  Deactivate Room (Soft Delete)
*/
router.patch(
  "/:roomId/deactivate",
  requireAuth,
  requirePermission("UPDATE_ROOM"),
  auditMiddleware("DEACTIVATE_ROOM", "ROOM", "Deactivated room"),
  roomController.deactivateRoom
);

/*
  Restore Room
*/
router.patch(
  "/:roomId/restore",
  requireAuth,
  requirePermission("UPDATE_ROOM"),
  auditMiddleware("RESTORE_ROOM", "ROOM", "Restored room"),
  roomController.restoreRoom
);

module.exports = router;
