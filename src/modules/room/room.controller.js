const roomService = require("./room.service");
const auditService = require("../audit/audit.service");
const Branch = require("../branch/branch.model");

/*
  Create Room
*/
exports.createRoom = async (req, res) => {
  try {
    const room = await roomService.createRoom(req.body, req.user);

    const branch = await Branch.findById(room.branchId).select("name");
    const actorRole =
      req.user?.role === "SUPER_ADMIN"
        ? "SuperAdmin"
        : req.user?.role === "CORPORATE_ADMIN"
          ? "Corporate Admin"
          : "User";

    await auditService.logAction({
      user: {
        userId: req.user.id || req.user.userId || req.user._id,
        role: req.user.role,
        organizationId: room.organizationId,
        branchId: room.branchId,
      },
      action: "CREATE_ROOM",
      message: `${actorRole} added a new room in ${branch?.name || "selected branch"}`,
      module: "ROOM",
      metadata: {
        roomId: room._id,
        roomNumber: room.roomNumber,
        branchName: branch?.name || null,
      },
      req,
    });

    return res.status(201).json({
      success: true,
      message: "Room created successfully",
      data: room,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to create room",
    });
  }
};

/*
  Get Rooms
*/
exports.getRooms = async (req, res) => {
  try {
    const { checkInDate, checkOutDate, totalGuests } = req.query;

    const rooms = await roomService.getRooms(
      req.user,
      checkInDate,
      checkOutDate,
      totalGuests,
    );

    return res.status(200).json({
      success: true,
      count: rooms.length,
      data: rooms,
    });
  } catch (error) {
    return res.status(error.statusCode || 403).json({
      success: false,
      message: error.message || "Failed to fetch rooms",
    });
  }
};

/*
  Update Room
*/
exports.updateRoom = async (req, res) => {
  try {
    const { roomId } = req.params;

    const updatedRoom = await roomService.updateRoom(
      roomId,
      req.body,
      req.user,
    );

    return res.status(200).json({
      success: true,
      message: "Room updated successfully",
      data: updatedRoom,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to update room",
    });
  }
};

/*
  Change Room Status
*/
exports.changeRoomStatus = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { status } = req.body;

    const updatedRoom = await roomService.changeRoomStatus(
      roomId,
      status,
      req.user,
    );

    return res.status(200).json({
      success: true,
      message: "Room status updated successfully",
      data: updatedRoom,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to change room status",
    });
  }
};

/*
  Deactivate Room (Soft Delete)
*/
exports.deactivateRoom = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await roomService.deactivateRoom(roomId, req.user);

    return res.status(200).json({
      success: true,
      message: "Room deactivated successfully",
      data: room,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to deactivate room",
    });
  }
};

/*
  Restore Room
*/
exports.restoreRoom = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await roomService.restoreRoom(roomId, req.user);

    return res.status(200).json({
      success: true,
      message: "Room restored successfully",
      data: room,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to restore room",
    });
  }
};
