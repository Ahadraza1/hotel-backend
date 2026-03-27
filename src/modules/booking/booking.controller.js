const bookingService = require("./booking.service");
const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

/*
  Multer Storage
*/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = "uploads/guest-identities";

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

/*
  Upload Middleware
*/
exports.uploadGuestIdentities = upload.fields([
  { name: "mainGuestIdentity", maxCount: 1 },
  { name: "guestsIdentity", maxCount: 20 },
]);

const parseGuestsFromBody = (body) => {
  if (Array.isArray(body.guests)) {
    return body.guests;
  }

  const guestMap = new Map();

  Object.entries(body).forEach(([key, value]) => {
    const match = key.match(/^guests\[(\d+)\]\[(name|email|phone)\]$/);
    if (!match) return;

    const [, index, field] = match;
    const guest = guestMap.get(index) || {
      name: "",
      email: "",
      phone: "",
    };

    guest[field] = value;
    guestMap.set(index, guest);
    delete body[key];
  });

  return Array.from(guestMap.entries())
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, guest]) => guest);
};

const hydrateBookingBody = (req) => {
  if (req.files?.mainGuestIdentity) {
    req.body.mainGuestIdentity = req.files.mainGuestIdentity[0].filename;
  }

  if (req.files?.guestsIdentity) {
    req.body.guestsIdentity = req.files.guestsIdentity.map((f) => f.filename);
  }

  req.body.guests = parseGuestsFromBody(req.body);
};

/*
  Create Booking
*/
exports.createBooking = asyncHandler(async (req, res) => {
  hydrateBookingBody(req);

  const booking = await bookingService.createBooking(req.body, req.user);

  return res.status(201).json({
    success: true,
    message: "Booking created successfully",
    data: booking,
  });
});

exports.getBookingById = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;

  if (!bookingId) {
    throw new AppError("Booking ID is required", 400);
  }

  const booking = await bookingService.getBookingById(bookingId, req.user);

  return res.status(200).json({
    success: true,
    data: booking,
  });
});

exports.updateBooking = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;

  if (!bookingId) {
    throw new AppError("Booking ID is required", 400);
  }

  hydrateBookingBody(req);

  const updatedBooking = await bookingService.updateBooking(
    bookingId,
    req.body,
    req.user,
  );

  return res.status(200).json({
    success: true,
    message: "Booking updated successfully",
    data: updatedBooking,
  });
});

exports.deleteBooking = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;

  if (!bookingId) {
    throw new AppError("Booking ID is required", 400);
  }

  await bookingService.deleteBooking(bookingId, req.user);

  return res.status(200).json({
    success: true,
    message: "Booking deleted successfully",
  });
});

/*
  Get Bookings
*/
exports.getBookings = asyncHandler(async (req, res) => {
  const bookings = await bookingService.getBookings(req.user);

  return res.status(200).json({
    success: true,
    count: bookings.length,
    data: bookings,
  });
});

/*
  Update Booking Status
*/
exports.updateBookingStatus = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const { status } = req.body;

  if (!bookingId) {
    throw new AppError("Booking ID is required", 400);
  }

  if (!status) {
    throw new AppError("Status is required", 400);
  }

  const updatedBooking = await bookingService.updateBookingStatus(
    bookingId,
    status,
    req.user,
  );

  return res.status(200).json({
    success: true,
    message: "Booking status updated successfully",
    data: updatedBooking,
  });
});
