const Booking = require("./booking.model");
const Room = require("../room/room.model");
const Invoice = require("../invoice/invoice.model");
const guestService = require("../crm/guest.service");
const branchSettingsService = require("../branchSettings/branchSettings.service");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

/*
  Permission Helper
*/
const requirePermission = (user, permission) => {
  // Platform super admin
  if (user.isPlatformAdmin) return;

  // Workspace roles always allowed
  if (
    user.role === "SUPER_ADMIN" ||
    user.role === "CORPORATE_ADMIN" ||
    user.role === "BRANCH_MANAGER"
  ) {
    return;
  }

  // fallback permission system
  if (!user.permissions || !user.permissions.includes(permission)) {
    const error = new Error("Permission denied");
    error.statusCode = 403;
    throw error;
  }
};

/*
  Create Booking
*/
const Branch = require("../branch/branch.model");

const normalizeGuests = (guests) =>
  Array.isArray(guests)
    ? guests.map((guest) => ({
        name: guest?.name || "",
        email: guest?.email || "",
        phone: guest?.phone || "",
      }))
    : [];

const ensureBookingRoomAvailability = async ({
  session,
  bookingId,
  roomId,
  user,
  checkInDate,
  checkOutDate,
}) => {
  const room = await Room.findById(roomId).session(session);

  if (!room || !room.isActive) {
    throw new Error("Room not found or inactive");
  }

  if (room.branchId.toString() !== user.branchId) {
    throw new Error("Room does not belong to active branch");
  }

  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);

  if (checkOut <= checkIn) {
    throw new Error("Invalid date selection");
  }

  const overlapQuery = {
    roomId: room._id,
    status: { $ne: "CANCELLED" },
    checkInDate: { $lt: checkOut },
    checkOutDate: { $gt: checkIn },
  };

  if (bookingId) {
    overlapQuery.bookingId = { $ne: bookingId };
  }

  const overlapping = await Booking.find(overlapQuery).session(session);

  if (overlapping.length > 0) {
    throw new Error("Room already booked for selected dates");
  }

  return { room, checkIn, checkOut };
};

exports.createBooking = async (data, user) => {
  requirePermission(user, "CREATE_BOOKING");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      roomId,
      guestName,
      guestType,
      guestPhone,
      guestEmail,
      totalGuests,
      guests,
      mainGuestIdentity,
      guestsIdentity,
      checkInDate,
      checkInTime,
      checkOutDate,
      checkOutTime,
    } = data;

    if (!roomId || !guestName || !guestType || !checkInDate || !checkOutDate) {
      throw new Error("Required fields are missing");
    }

    if (!user.branchId) {
      throw new Error("No active branch selected");
    }

    // 🔥 Always derive org from branch
    const branch = await Branch.findById(user.branchId).session(session);

    if (!branch) {
      throw new Error("Branch not found");
    }

    const { room, checkIn, checkOut } = await ensureBookingRoomAvailability({
      session,
      roomId,
      user,
      checkInDate,
      checkOutDate,
    });

    const nights =
      (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24);

    const totalAmount = nights * room.pricePerNight;

    const bookingArr = await Booking.create(
      [
        {
          bookingId: uuidv4(),
          organizationId: branch.organizationId,
          branchId: branch._id,
          roomId: room._id,

          guestName,
          guestType,
          guestPhone,
          guestEmail,
          totalGuests,

          mainGuestIdentity,
          guestsIdentity,

          guests: normalizeGuests(guests),

          checkInDate,
          checkInTime,
          checkOutDate,
          checkOutTime,

          nights,
          totalAmount,
          status: "CONFIRMED",
          createdBy: user.id || user.userId,
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    // 🔥 Attach identity docs before CRM sync
const bookingData = bookingArr[0].toObject();

bookingData.mainGuestIdentity = mainGuestIdentity || null;
bookingData.guestsIdentity = guestsIdentity || [];

await guestService.syncGuestFromBooking(
  bookingData,
  user
);

    return bookingArr[0];
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/*
  Get Bookings
*/
exports.getBookings = async (user) => {
  requirePermission(user, "VIEW_BOOKING");

  if (!user.branchId) {
    throw new Error("No active branch selected");
  }

  return await Booking.find({
    branchId: user.branchId,
    isActive: true,
  }).sort({ createdAt: -1 });
};

exports.getBookingById = async (bookingId, user) => {
  requirePermission(user, "VIEW_BOOKING");

  if (!user.branchId) {
    throw new Error("No active branch selected");
  }

  const booking = await Booking.findOne({
    bookingId,
    branchId: user.branchId,
    isActive: true,
  });

  if (!booking) {
    throw new Error("Booking not found");
  }

  return booking;
};

exports.updateBooking = async (bookingId, data, user) => {
  requirePermission(user, "UPDATE_BOOKING");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await Booking.findOne({
      bookingId,
      branchId: user.branchId,
      isActive: true,
    }).session(session);

    if (!booking) {
      throw new Error("Booking not found");
    }

    const {
      roomId,
      guestName,
      guestType,
      guestPhone,
      guestEmail,
      totalGuests,
      guests,
      mainGuestIdentity,
      guestsIdentity,
      checkInDate,
      checkInTime,
      checkOutDate,
      checkOutTime,
    } = data;

    if (!roomId || !guestName || !guestType || !checkInDate || !checkOutDate) {
      throw new Error("Required fields are missing");
    }

    const { room, checkIn, checkOut } = await ensureBookingRoomAvailability({
      session,
      bookingId,
      roomId,
      user,
      checkInDate,
      checkOutDate,
    });

    const nights =
      (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24);
    const totalAmount = nights * room.pricePerNight;

    booking.roomId = room._id;
    booking.guestName = guestName;
    booking.guestType = guestType;
    booking.guestPhone = guestPhone;
    booking.guestEmail = guestEmail;
    booking.totalGuests = totalGuests;
    booking.guests = normalizeGuests(guests);
    booking.checkInDate = checkInDate;
    booking.checkInTime = checkInTime;
    booking.checkOutDate = checkOutDate;
    booking.checkOutTime = checkOutTime;
    booking.nights = nights;
    booking.totalAmount = totalAmount;
    booking.updatedBy = user.id || user.userId;

    if (mainGuestIdentity) {
      booking.mainGuestIdentity = mainGuestIdentity;
    }

    if (guestsIdentity) {
      booking.guestsIdentity = guestsIdentity;
    }

    await booking.save({ session });

    await session.commitTransaction();
    session.endSession();

    return booking;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

exports.deleteBooking = async (bookingId, user) => {
  requirePermission(user, "DELETE_BOOKING");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await Booking.findOne({
      bookingId,
      branchId: user.branchId,
    }).session(session);

    if (!booking) {
      throw new Error("Booking not found");
    }

    if (booking.status === "CHECKED_IN") {
      await Room.findByIdAndUpdate(
        booking.roomId,
        { status: "AVAILABLE" },
        { session },
      );
    }

    await Booking.deleteOne({ _id: booking._id }).session(session);

    await session.commitTransaction();
    session.endSession();
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/*
  Update Booking Status
*/
exports.updateBookingStatus = async (bookingId, status, user) => {
  requirePermission(user, "CANCEL_BOOKING");

  const allowedStatuses = [
    "CONFIRMED",
    "CHECKED_IN",
    "CHECKED_OUT",
    "CANCELLED",
  ];

  if (!allowedStatuses.includes(status)) {
    throw new Error("Invalid status");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await Booking.findOne({
      bookingId: bookingId,
      branchId: user.branchId, // ✅ ensure correct workspace isolation
    }).session(session);

    if (!booking) {
      throw new Error("Booking not found");
    }

    booking.status = status;
    await booking.save({ session });

    // CHECK-IN → Create Invoice
    if (status === "CHECKED_IN") {
      const financialSettings =
        await branchSettingsService.getFinancialSettingsByBranchId(
          booking.branchId,
        );
      const taxAmount =
        (booking.totalAmount * financialSettings.taxPercentage) / 100;
      const serviceChargeAmount =
        (booking.totalAmount * financialSettings.serviceChargePercentage) / 100;
      const discountAmount = 0;
      const finalAmount =
        booking.totalAmount + taxAmount + serviceChargeAmount - discountAmount;

      await Invoice.create(
        [
          {
            organizationId: booking.organizationId,
            branchId: booking.branchId,
            bookingId: booking._id,
            type: "ROOM",
            referenceType: "BOOKING",
            referenceId: booking.bookingId,
            lineItems: [
              {
                description: "Room Charges",
                quantity: booking.nights,
                unitPrice: booking.totalAmount / booking.nights,
                total: booking.totalAmount,
              },
            ],
            totalAmount: booking.totalAmount,
            taxAmount,
            serviceChargeAmount,
            discountAmount,
            finalAmount,
            paidAmount: 0,
            dueAmount: finalAmount,
            status: "UNPAID",
            createdBy: user.id || user.userId,
          },
        ],
        { session },
      );

      await Room.findByIdAndUpdate(
        booking.roomId,
        { status: "OCCUPIED" },
        { session },
      );
    }

    if (status === "CHECKED_OUT") {
      await Room.findByIdAndUpdate(
        booking.roomId,
        { status: "AVAILABLE" },
        { session },
      );
    }

    await session.commitTransaction();
    session.endSession();

    return booking;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("UPDATE BOOKING ERROR:", error.message);
    throw error;
  }
};
