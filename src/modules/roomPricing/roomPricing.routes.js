const express = require("express");

const roomPricingController = require("./roomPricing.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
const requireBranchAccess = require("../../middleware/requireBranchAccess.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

const router = express.Router();

router.get(
  "/",
  requireAuth,
  requireBranchAccess,
  requirePermission(["ACCESS_ROOMS", "VIEW_ROOM"]),
  roomPricingController.getRoomPrices,
);

router.post(
  "/",
  requireAuth,
  requireBranchAccess,
  requirePermission("UPDATE_ROOM"),
  roomPricingController.upsertRoomPrice,
);

router.post(
  "/bulk",
  requireAuth,
  requireBranchAccess,
  requirePermission("UPDATE_ROOM"),
  roomPricingController.bulkUpsertRoomPrices,
);

module.exports = router;
