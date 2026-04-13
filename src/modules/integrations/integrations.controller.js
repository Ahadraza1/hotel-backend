const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const bookingService = require("../booking/booking.service");

exports.getIntegrations = async (req, res) => {
  try {
    res.status(200).json({
      data: [
        {
          name: "Stripe",
          status: "connected",
          type: "Payment Gateway",
        },
        {
          name: "Twilio",
          status: "connected",
          type: "SMS Service",
        },
        {
          name: "SendGrid",
          status: "disconnected",
          type: "Email Service",
        },
      ],
    });
  } catch (error) {
    res.status(400).json({
      message: error.message,
    });
  }
};

exports.receiveIntegrationBooking = asyncHandler(async (req, res) => {
  const {
    guestName,
    checkIn,
    checkOut,
    roomType,
    bookingId,
    platform,
    branchId,
  } = req.body || {};

  if (!guestName || !checkIn || !checkOut || !roomType || !bookingId || !platform || !branchId) {
    throw new AppError(
      "guestName, checkIn, checkOut, roomType, bookingId, platform, and branchId are required",
      400,
    );
  }

  const booking = await bookingService.createOtaBooking(req.body);

  return res.status(201).json({
    success: true,
    message: "OTA booking received successfully",
    data: booking,
  });
});
