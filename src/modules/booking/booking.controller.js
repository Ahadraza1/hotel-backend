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
    const uploadPath = path.join(__dirname, "../../../uploads/guest-identities");

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
  { name: "identityProof", maxCount: 1 },
  { name: "identityDocument", maxCount: 1 },
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

const normalizeIncludedMealsFromBody = (body) => {
  if (Array.isArray(body.includedMeals)) {
    return body.includedMeals;
  }

  const includedMeals = [];

  Object.entries(body).forEach(([key, value]) => {
    if (key === "includedMeals[]" || key === "includedMeals") {
      if (Array.isArray(value)) {
        includedMeals.push(...value);
      } else if (value) {
        includedMeals.push(value);
      }
      delete body[key];
    }
  });

  return includedMeals;
};

const hydrateBookingBody = (req) => {
  const identityFile =
    req.files?.identityProof?.[0] ||
    req.files?.identityDocument?.[0] || req.files?.mainGuestIdentity?.[0];

  if (identityFile) {
    const relativePath = `/uploads/guest-identities/${identityFile.filename}`;
    req.body.identityProof = {
      url: relativePath,
      fileName: identityFile.originalname,
      fileType: identityFile.mimetype,
    };
    req.body.identityDocument = {
      url: relativePath,
      fileName: identityFile.originalname,
      fileType: identityFile.mimetype,
    };
    req.body.mainGuestIdentity = relativePath;
  }

  if (req.files?.guestsIdentity) {
    req.body.guestsIdentity = req.files.guestsIdentity.map(
      (f) => `/uploads/guest-identities/${f.filename}`,
    );
  }

  req.body.guests = parseGuestsFromBody(req.body);
  req.body.includedMeals = normalizeIncludedMealsFromBody(req.body);
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

exports.checkInBooking = asyncHandler(async (req, res) => {
  const bookingId = req.params.bookingId || req.body.bookingId;

  if (!bookingId) {
    throw new AppError("Booking ID is required", 400);
  }

  const updatedBooking = await bookingService.checkInBooking(bookingId, req.user);

  return res.status(200).json({
    success: true,
    message: "Booking checked in successfully",
    data: updatedBooking,
  });
});

exports.checkOutBooking = asyncHandler(async (req, res) => {
  const bookingId = req.params.bookingId || req.body.bookingId;

  if (!bookingId) {
    throw new AppError("Booking ID is required", 400);
  }

  const updatedBooking = await bookingService.checkOutBooking(bookingId, req.user);

  return res.status(200).json({
    success: true,
    message: "Booking checked out successfully",
    data: updatedBooking,
  });
});

exports.addBookingService = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;

  if (!bookingId) {
    throw new AppError("Booking ID is required", 400);
  }

  const booking = await bookingService.addBookingService(
    bookingId,
    req.body,
    req.user,
  );

  return res.status(200).json({
    success: true,
    message: "Service added successfully",
    data: booking,
  });
});

exports.updateBookingService = asyncHandler(async (req, res) => {
  const { bookingId, serviceId } = req.params;

  if (!bookingId || !serviceId) {
    throw new AppError("Booking ID and service ID are required", 400);
  }

  const booking = await bookingService.updateBookingService(
    bookingId,
    serviceId,
    req.body,
    req.user,
  );

  return res.status(200).json({
    success: true,
    message: "Service updated successfully",
    data: booking,
  });
});

exports.removeBookingService = asyncHandler(async (req, res) => {
  const { bookingId, serviceId } = req.params;

  if (!bookingId || !serviceId) {
    throw new AppError("Booking ID and service ID are required", 400);
  }

  const booking = await bookingService.removeBookingService(
    bookingId,
    serviceId,
    req.user,
  );

  return res.status(200).json({
    success: true,
    message: "Service removed successfully",
    data: booking,
  });
});

exports.processBookingPayment = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const { method } = req.body;

  if (!bookingId) {
    throw new AppError("Booking ID is required", 400);
  }

  if (!method) {
    throw new AppError("Payment method is required", 400);
  }

  const booking = await bookingService.processBookingPayment(
    bookingId,
    method,
    req.user,
  );

  return res.status(200).json({
    success: true,
    message: "Payment processed successfully",
    data: booking,
  });
});

exports.generateBookingInvoice = asyncHandler(async (req, res) => {
  const { bookingId } = req.params;

  if (!bookingId) {
    throw new AppError("Booking ID is required", 400);
  }

  const invoice = await bookingService.generateBookingInvoice(
    bookingId,
    req.user,
  );

  return res.status(200).json({
    success: true,
    message: "Invoice ready",
    data: invoice,
  });
});
