const Booking = require("../booking/booking.model");
const Room = require("./room.model");

const ROOM_STATUSES = {
  AVAILABLE: "AVAILABLE",
  BOOKED: "BOOKED",
  OCCUPIED: "OCCUPIED",
  MAINTENANCE: "MAINTENANCE",
  BLOCKED: "BLOCKED",
};

const BOOKING_STATUSES = {
  BOOKED: "BOOKED",
  CONFIRMED: "CONFIRMED",
  CHECKED_IN: "CHECKED_IN",
  COMPLETED: "COMPLETED",
  CHECKED_OUT: "CHECKED_OUT",
  CANCELLED: "CANCELLED",
};

const MANUAL_OVERRIDE_STATUSES = new Set([
  ROOM_STATUSES.AVAILABLE,
  ROOM_STATUSES.MAINTENANCE,
  ROOM_STATUSES.BLOCKED,
]);

const normalizeBookingStatus = (status) => {
  switch (String(status || "").toUpperCase()) {
    case BOOKING_STATUSES.CONFIRMED:
      return BOOKING_STATUSES.BOOKED;
    case BOOKING_STATUSES.CHECKED_OUT:
      return BOOKING_STATUSES.COMPLETED;
    default:
      return String(status || "").toUpperCase();
  }
};

const getDerivedRoomStatusFromBookingStatus = (status) => {
  const normalizedStatus = normalizeBookingStatus(status);

  if (normalizedStatus === BOOKING_STATUSES.CHECKED_IN) {
    return ROOM_STATUSES.OCCUPIED;
  }

  if (normalizedStatus === BOOKING_STATUSES.BOOKED) {
    return ROOM_STATUSES.BOOKED;
  }

  if (
    normalizedStatus === BOOKING_STATUSES.COMPLETED ||
    normalizedStatus === BOOKING_STATUSES.CANCELLED
  ) {
    return ROOM_STATUSES.AVAILABLE;
  }

  return null;
};

const getHighestPriorityBooking = (bookings = []) => {
  const normalizedBookings = bookings
    .map((booking) => ({
      ...booking,
      normalizedStatus: normalizeBookingStatus(booking.status),
    }))
    .filter(
      (booking) =>
        booking.normalizedStatus === BOOKING_STATUSES.BOOKED ||
        booking.normalizedStatus === BOOKING_STATUSES.CHECKED_IN,
    );

  const checkedInBooking = normalizedBookings.find(
    (booking) => booking.normalizedStatus === BOOKING_STATUSES.CHECKED_IN,
  );

  if (checkedInBooking) {
    return checkedInBooking;
  }

  return normalizedBookings[0] || null;
};

const resolveRoomStatus = ({ room, bookings = [] }) => {
  if (room?.manualOverrideActive && room?.manualOverrideStatus) {
    return room.manualOverrideStatus;
  }

  const activeBooking = getHighestPriorityBooking(bookings);

  if (!activeBooking) {
    return ROOM_STATUSES.AVAILABLE;
  }

  return (
    getDerivedRoomStatusFromBookingStatus(activeBooking.status) ||
    ROOM_STATUSES.AVAILABLE
  );
};

const getRoomStatusSnapshot = async ({ roomId, session = null }) => {
  const roomQuery = Room.findById(roomId);
  const bookingsQuery = Booking.find({
    roomId,
    isActive: true,
    status: {
      $in: [
        BOOKING_STATUSES.BOOKED,
        BOOKING_STATUSES.CONFIRMED,
        BOOKING_STATUSES.CHECKED_IN,
      ],
    },
  })
    .sort({ checkInDate: 1, createdAt: 1 })
    .lean();

  if (session) {
    roomQuery.session(session);
    bookingsQuery.session(session);
  }

  const [room, bookings] = await Promise.all([roomQuery, bookingsQuery]);

  if (!room) {
    return null;
  }

  return {
    room,
    bookings,
    resolvedStatus: resolveRoomStatus({ room, bookings }),
  };
};

const syncRoomStatusByRoomId = async ({
  roomId,
  session = null,
  allowManualOverride = false,
}) => {
  const snapshot = await getRoomStatusSnapshot({ roomId, session });

  if (!snapshot) {
    return null;
  }

  const { room, resolvedStatus } = snapshot;
  const nextStatus =
    allowManualOverride || !room.manualOverrideActive
      ? resolvedStatus
      : room.manualOverrideStatus || room.status;

  if (room.status === nextStatus) {
    return room;
  }

  await Room.findByIdAndUpdate(
    roomId,
    { status: nextStatus },
    { new: true, session },
  );

  return {
    ...room.toObject(),
    status: nextStatus,
  };
};

const syncBranchRoomStatuses = async ({ branchId, roomIds = null }) => {
  const roomQuery = {
    branchId,
    isActive: true,
    ...(roomIds?.length ? { _id: { $in: roomIds } } : {}),
  };

  const [rooms, bookings] = await Promise.all([
    Room.find(roomQuery).lean(),
    Booking.find({
      branchId,
      isActive: true,
      status: {
        $in: [
          BOOKING_STATUSES.BOOKED,
          BOOKING_STATUSES.CONFIRMED,
          BOOKING_STATUSES.CHECKED_IN,
        ],
      },
      ...(roomIds?.length ? { roomId: { $in: roomIds } } : {}),
    })
      .sort({ checkInDate: 1, createdAt: 1 })
      .lean(),
  ]);

  const bookingsByRoomId = new Map();

  bookings.forEach((booking) => {
    const key = booking.roomId.toString();
    const roomBookings = bookingsByRoomId.get(key) || [];
    roomBookings.push(booking);
    bookingsByRoomId.set(key, roomBookings);
  });

  const updates = [];
  const hydratedRooms = rooms.map((room) => {
    const resolvedStatus = resolveRoomStatus({
      room,
      bookings: bookingsByRoomId.get(room._id.toString()) || [],
    });

    if (room.status !== resolvedStatus) {
      updates.push({
        updateOne: {
          filter: { _id: room._id },
          update: { $set: { status: resolvedStatus } },
        },
      });
    }

    return {
      ...room,
      status: resolvedStatus,
    };
  });

  if (updates.length > 0) {
    await Room.bulkWrite(updates);
  }

  return hydratedRooms;
};

module.exports = {
  ROOM_STATUSES,
  BOOKING_STATUSES,
  MANUAL_OVERRIDE_STATUSES,
  normalizeBookingStatus,
  getDerivedRoomStatusFromBookingStatus,
  resolveRoomStatus,
  syncRoomStatusByRoomId,
  syncBranchRoomStatuses,
};
