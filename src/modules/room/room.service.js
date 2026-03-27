const Room = require("./room.model");
const Booking = require("../booking/booking.model");

/*
  Helper: Permission Check
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
  Create Room
*/
const Branch = require("../branch/branch.model");

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

  // 🔥 Must have active workspace branch
  if (!user.branchId) {
    const error = new Error("No active branch selected");
    error.statusCode = 400;
    throw error;
  }

  // 🔥 Always derive organization from branch
  const branch = await Branch.findById(user.branchId);

  if (!branch) {
    const error = new Error("Branch not found");
    error.statusCode = 404;
    throw error;
  }

  const room = await Room.create({
    organizationId: branch.organizationId, // ✅ derived from branch
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

  return room;
};

/*
  Get Rooms
*/
exports.getRooms = async (user, checkInDate, checkOutDate, totalGuests) => {
  requirePermission(user, "VIEW_ROOM");

  if (!user.branchId) {
    const error = new Error("No active branch selected");
    error.statusCode = 400;
    throw error;
  }

  // Get all active rooms of branch
  const rooms = await Room.find({
    branchId: user.branchId,
    isActive: true,
    ...(totalGuests && { capacity: { $gte: Number(totalGuests) } }),
  });

  // If no dates → return all rooms
  if (!checkInDate || !checkOutDate) {
    return rooms;
  }

  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);

  // Find overlapping bookings
  const overlappingBookings = await Booking.find({
    branchId: user.branchId,
    status: { $ne: "CANCELLED" },
    checkInDate: { $lt: checkOut },
    checkOutDate: { $gt: checkIn },
  }).select("roomId");

  const bookedRoomIds = overlappingBookings.map((b) => b.roomId.toString());

  // Filter rooms
  const availableRooms = rooms.filter(
    (room) => !bookedRoomIds.includes(room._id.toString()),
  );

  return availableRooms;
};

/*
  Update Room
*/
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
    return await Room.findByIdAndUpdate(roomId, data, { new: true });
  }

  const error = new Error("Access denied");
  error.statusCode = 403;
  throw error;
};

/*
  Change Room Status
*/
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
    return await Room.findByIdAndUpdate(roomId, { status }, { new: true });
  }

  const error = new Error("Access denied");
  error.statusCode = 403;
  throw error;
};

/*
  Deactivate Room
*/
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
    return await Room.findByIdAndUpdate(
      roomId,
      { isActive: false },
      { new: true },
    );
  }

  const error = new Error("Access denied");
  error.statusCode = 403;
  throw error;
};

/*
  Restore Room
*/
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

  return await Room.findByIdAndUpdate(
    roomId,
    { isActive: true },
    { new: true },
  );
};
