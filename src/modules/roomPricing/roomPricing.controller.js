const roomPricingService = require("./roomPricing.service");

exports.getRoomPrices = async (req, res) => {
  try {
    const prices = await roomPricingService.listRoomPrices({
      user: req.user,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    return res.status(200).json({
      success: true,
      count: prices.length,
      data: prices,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to fetch room prices",
    });
  }
};

exports.upsertRoomPrice = async (req, res) => {
  try {
    const roomPrice = await roomPricingService.upsertRoomPrice({
      user: req.user,
      roomTypeId: req.body?.roomTypeId,
      date: req.body?.date,
      price: req.body?.price,
    });

    return res.status(200).json({
      success: true,
      message: "Room price saved successfully",
      data: roomPrice,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to save room price",
    });
  }
};

exports.bulkUpsertRoomPrices = async (req, res) => {
  try {
    const roomPrices = await roomPricingService.bulkUpsertRoomPrices({
      user: req.user,
      updates: req.body?.updates || [],
    });

    return res.status(200).json({
      success: true,
      message: "Room prices published successfully",
      count: roomPrices.length,
      data: roomPrices,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to publish room prices",
    });
  }
};
