const roomTypeService = require("./roomType.service");

exports.getRoomTypes = async (req, res) => {
  try {
    const roomTypes = await roomTypeService.listRoomTypes(req.user);

    return res.status(200).json({
      success: true,
      count: roomTypes.length,
      data: roomTypes,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to fetch room types",
    });
  }
};

exports.createRoomType = async (req, res) => {
  try {
    const roomType = await roomTypeService.createRoomType(req.body, req.user);

    return res.status(201).json({
      success: true,
      message: "Room type created successfully",
      data: roomType,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to create room type",
    });
  }
};

exports.updateRoomType = async (req, res) => {
  try {
    const roomType = await roomTypeService.updateRoomType(
      req.params.roomTypeId,
      req.body,
      req.user,
    );

    return res.status(200).json({
      success: true,
      message: "Room type updated successfully",
      data: roomType,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to update room type",
    });
  }
};

exports.deleteRoomType = async (req, res) => {
  try {
    const roomType = await roomTypeService.deleteRoomType(
      req.params.roomTypeId,
      req.user,
    );

    return res.status(200).json({
      success: true,
      message: "Room type deleted successfully",
      data: roomType,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to delete room type",
    });
  }
};
