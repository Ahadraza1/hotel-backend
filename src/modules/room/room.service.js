const Room = require("./room.model");
const Booking = require("../booking/booking.model");
const Branch = require("../branch/branch.model");

const requirePermission = (user, permission) => {
  if (user.isPlatformAdmin) return;

  if (
    user.role === "SUPER_ADMIN" ||
    user.role === "CORPORATE_ADMIN" ||
    user.role === "BRANCH_MANAGER"
  ) {
    return;
  }

  if (!user.permissions || !user.permissions.includes(permission)) {
    const error = new Error("Permission denied");
    error.statusCode = 403;
    throw error;
  }
};

exports.createRoom = async (data, user) => {
  requirePermission(user, "CREATE_ROOM");

  const {
    roomNumber,
    roomType,
    pricePerNight,
    capacity,
    amenities,
    description,
    maxOccupancy,
    bedType,
  } = data;

  if (!roomNumber || !roomType || !pricePerNight) {
    const error = new Error("Required fields are missing");
    error.statusCode = 400;
    throw error;
  }

  if (
    !maxOccupancy ||
    maxOccupancy.adults === undefined ||
    maxOccupancy.children === undefined
  ) {
    const error = new Error("Max occupancy is required");
    error.statusCode = 400;
    throw error;
  }

  if (Number(maxOccupancy.adults) < 0 || Number(maxOccupancy.children) < 0) {
    const error = new Error("Max occupancy must be 0 or greater");
    error.statusCode = 400;
    throw error;
  }

  if (!bedType) {
    const error = new Error("Bed type is required");
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(amenities) || amenities.length === 0) {
    const error = new Error("At least one amenity is required");
    error.statusCode = 400;
    throw error;
  }

  if (!user.branchId) {
    const error = new Error("No active branch selected");
    error.statusCode = 400;
    throw error;
  }

  const branch = await Branch.findById(user.branchId);

  if (!branch) {
    const error = new Error("Branch not found");
    error.statusCode = 404;
    throw error;
  }

  return Room.create({
    organizationId: branch.organizationId,
    branchId: branch._id,
    roomNumber,
    roomType,
    pricePerNight,
    capacity,
    amenities,
    description,
    maxOccupancy: {
      adults: Number(maxOccupancy.adults),
      children: Number(maxOccupancy.children),
    },
    bedType,
    createdBy: user._id,
  });
};

exports.getRooms = async (user, checkInDate, checkOutDate, totalGuests, status) => {
  requirePermission(user, "VIEW_ROOM");

  if (!user.branchId) {
    const error = new Error("No active branch selected");
    error.statusCode = 400;
    throw error;
  }

  const normalizedStatus = String(status || "").toUpperCase();

  if (normalizedStatus === "CHECKED_IN") {
    const checkedInBookings = await Booking.find({
      branchId: user.branchId,
      status: "CHECKED_IN",
      isActive: true,
    })
      .populate("roomId")
      .select("_id bookingId guestName roomId")
      .lean();

    return checkedInBookings
      .filter((booking) => booking.roomId && booking.roomId.isActive)
      .map((booking) => ({
        ...booking.roomId,
        _id: booking.roomId._id,
        currentGuestName: booking.guestName,
        currentBookingId: booking.bookingId,
        occupancyStatus: "CHECKED_IN",
      }));
  }

  const rooms = await Room.find({
    branchId: user.branchId,
    isActive: true,
    ...(totalGuests && { capacity: { $gte: Number(totalGuests) } }),
    ...(normalizedStatus ? { status: normalizedStatus } : {}),
  });

  if (!checkInDate || !checkOutDate) {
    return rooms;
  }

  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);

  const overlappingBookings = await Booking.find({
    branchId: user.branchId,
    status: { $ne: "CANCELLED" },
    checkInDate: { $lt: checkOut },
    checkOutDate: { $gt: checkIn },
  }).select("roomId");

  const bookedRoomIds = overlappingBookings.map((booking) =>
    booking.roomId.toString(),
  );

  return rooms.filter((room) => !bookedRoomIds.includes(room._id.toString()));
};

exports.updateRoom = async (roomId, data, user) => {
  requirePermission(user, "UPDATE_ROOM");

  const room = await Room.findById(roomId);

  if (!room) {
    const error = new Error("Room not found");
    error.statusCode = 404;
    throw error;
  }

  if (
    user.role === "SUPER_ADMIN" ||
    (user.role === "CORPORATE_ADMIN" &&
      room.organizationId?.toString() === user.organizationId) ||
    (user.role === "BRANCH_MANAGER" &&
      room.branchId?.toString() === user.branchId)
  ) {
    return Room.findByIdAndUpdate(roomId, data, { new: true });
  }

  const error = new Error("Access denied");
  error.statusCode = 403;
  throw error;
};

exports.changeRoomStatus = async (roomId, status, user) => {
  requirePermission(user, "UPDATE_ROOM");

  const room = await Room.findById(roomId);

  if (!room) {
    const error = new Error("Room not found");
    error.statusCode = 404;
    throw error;
  }

  if (
    user.role === "SUPER_ADMIN" ||
    (user.role === "CORPORATE_ADMIN" &&
      room.organizationId?.toString() === user.organizationId) ||
    (user.role === "BRANCH_MANAGER" &&
      room.branchId?.toString() === user.branchId)
  ) {
    return Room.findByIdAndUpdate(roomId, { status }, { new: true });
  }

  const error = new Error("Access denied");
  error.statusCode = 403;
  throw error;
};

exports.deactivateRoom = async (roomId, user) => {
  requirePermission(user, "UPDATE_ROOM");

  const room = await Room.findById(roomId);

  if (!room) {
    const error = new Error("Room not found");
    error.statusCode = 404;
    throw error;
  }

  if (
    user.role === "SUPER_ADMIN" ||
    (user.role === "CORPORATE_ADMIN" &&
      room.organizationId?.toString() === user.organizationId) ||
    (user.role === "BRANCH_MANAGER" &&
      room.branchId?.toString() === user.branchId)
  ) {
    return Room.findByIdAndUpdate(roomId, { isActive: false }, { new: true });
  }

  const error = new Error("Access denied");
  error.statusCode = 403;
  throw error;
};

exports.restoreRoom = async (roomId, user) => {
  requirePermission(user, "UPDATE_ROOM");

  const room = await Room.findById(roomId);

  if (!room) {
    const error = new Error("Room not found");
    error.statusCode = 404;
    throw error;
  }

  if (!user.branchId || room.branchId.toString() !== user.branchId) {
    const error = new Error("Access denied");
    error.statusCode = 403;
    throw error;
  }

  return Room.findByIdAndUpdate(roomId, { isActive: true }, { new: true });
};
