const express = require("express");
const router = express.Router();

const guestController = require("./guest.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  ===========================
  CRM - GUEST ROUTES
  ===========================
*/

/*
  Create Guest
  POST /crm/guests
*/
router.post(
  "/guests",
  requireAuth,
  requirePermission("ACCESS_CRM"),
  guestController.createGuest
);

/*
  Get Guests
  GET /crm/guests
*/
router.get(
  "/guests",
  requireAuth,
  requirePermission("ACCESS_CRM"),
  guestController.getGuests
);

/*
  Update Guest
  PUT /crm/guests/:guestId
*/
router.put(
  "/guests/:guestId",
  requireAuth,
  requirePermission("ACCESS_CRM"),
  guestController.updateGuest
);

/*
  Delete Guest
  DELETE /crm/guests/:guestId
*/
router.delete(
  "/guests/:guestId",
  requireAuth,
  requirePermission("ACCESS_CRM"),
  guestController.deleteGuest
);

/*
  Toggle VIP
  PATCH /crm/guests/:guestId/vip
*/
router.patch(
  "/guests/:guestId/vip",
  requireAuth,
  requirePermission("ACCESS_CRM"),
  guestController.toggleVIP
);

/*
  Toggle Blacklist
  PATCH /crm/guests/:guestId/blacklist
*/
router.patch(
  "/guests/:guestId/blacklist",
  requireAuth,
  requirePermission("ACCESS_CRM"),
  guestController.toggleBlacklist
);

/*
  Get Guest Profile (History + Loyalty)
  GET /crm/guests/:guestId/profile
*/
router.get(
  "/guests/:guestId/profile",
  requireAuth,
  requirePermission("ACCESS_CRM"),
  guestController.getGuestProfile
);

module.exports = router;
