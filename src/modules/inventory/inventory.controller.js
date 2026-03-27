const inventoryService = require("./inventory.service");
const asyncHandler = require("../../utils/asyncHandler");
const AppError = require("../../utils/AppError");

/*
  Create Inventory Item
*/
exports.createItem = asyncHandler(async (req, res) => {

  const item = await inventoryService.createItem(
    req.body,
    req.user
  );

  return res.status(201).json({
    success: true,
    message: "Inventory item created successfully",
    data: item,
  });
});


/*
  Add Stock (IN)
*/
exports.addStock = asyncHandler(async (req, res) => {

  const updatedItem = await inventoryService.addStock(
    req.body,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Stock added successfully",
    data: updatedItem,
  });
});


/*
  Remove Stock (OUT)
*/
exports.removeStock = asyncHandler(async (req, res) => {

  const updatedItem = await inventoryService.removeStock(
    req.body,
    req.user
  );

  return res.status(200).json({
    success: true,
    message: "Stock removed successfully",
    data: updatedItem,
  });
});


/*
  Get Inventory
*/
exports.getInventory = asyncHandler(async (req, res) => {

  const inventory = await inventoryService.getInventory(
    req.user
  );

  return res.status(200).json({
    success: true,
    count: inventory.length,
    data: inventory,
  });
});


/*
  Get Inventory Summary
*/
exports.getInventorySummary = asyncHandler(async (req, res) => {

  const summary = await inventoryService.getInventorySummary(
    req.user
  );

  return res.status(200).json({
    success: true,
    data: summary,
  });
});