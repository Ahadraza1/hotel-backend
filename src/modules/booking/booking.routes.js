const express = require("express");
const router = express.Router();

const bookingController = require("./booking.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");
const auditMiddleware = require("../audit/audit.middleware");

/*
  Create Booking
*/
router.post(
  "/",
  requireAuth,
  requirePermission("CREATE_BOOKING"),
  bookingController.uploadGuestIdentities,
  auditMiddleware("BOOKING_CREATED", "BOOKING", "Created booking"),
  bookingController.createBooking
);

/*
  Get Bookings
*/
router.get(
  "/",
  requireAuth,
  requirePermission("VIEW_BOOKING"),
  bookingController.getBookings
);

router.get(
  "/:bookingId",
  requireAuth,
  requirePermission("VIEW_BOOKING"),
  bookingController.getBookingById
);

router.put(
  "/:bookingId",
  requireAuth,
  requirePermission("UPDATE_BOOKING"),
  bookingController.uploadGuestIdentities,
  auditMiddleware("BOOKING_UPDATED", "BOOKING", "Updated booking"),
  bookingController.updateBooking
);

router.delete(
  "/:bookingId",
  requireAuth,
  requirePermission("DELETE_BOOKING"),
  auditMiddleware("BOOKING_DELETED", "BOOKING", "Deleted booking"),
  bookingController.deleteBooking
);

/*
  Update Booking Status (Check-in / Check-out / Cancel)
*/
router.patch(
  "/:bookingId/status",
  requireAuth,
  requirePermission("CANCEL_BOOKING"),
  auditMiddleware("BOOKING_STATUS_UPDATED", "BOOKING", "Updated booking status"),
  bookingController.updateBookingStatus
);

module.exports = router;
