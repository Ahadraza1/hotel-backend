const InventoryItem = require("./inventory.model");
const StockMovement = require("./stockMovement.model");

/*
  Permission Helper
*/
const requirePermission = (user, permission) => {

  // ✅ SUPER ADMIN FULL ACCESS
  if (user.isPlatformAdmin || user.role === "SUPER_ADMIN") return;

  // ✅ CORPORATE ADMIN FULL BRANCH WORKSPACE ACCESS
  if (user.role === "CORPORATE_ADMIN") return;

  // ✅ BRANCH MANAGER FULL BRANCH WORKSPACE ACCESS
  if (user.role === "BRANCH_MANAGER") return;

  if (!user.permissions || !user.permissions.includes(permission)) {
    const error = new Error("Permission denied");
    error.statusCode = 403;
    throw error;
  }
};

/*
  Create Inventory Item
*/
exports.createItem = async (data, user) => {
  requirePermission(user, "ACCESS_INVENTORY");

  const {
    name,
    category,
    unit,
    minimumStockLevel,
    costPerUnit,
    quantityAvailable,
  } = data;

  if (!name || !category || !unit) {
    throw new Error("Required fields missing");
  }

  const Branch = require("../branch/branch.model");

  if (!data.branchId) {
    throw new Error("BranchId is required");
  }

  const branch = await Branch.findById(data.branchId);

  if (!branch) {
    throw new Error("Branch not found");
  }

  const item = await InventoryItem.create({
    organizationId: branch.organizationId, // ✅ FIXED
    branchId: branch._id.toString(), // ✅ SAFE
    name,
    category,
    unit,
    minimumStockLevel: minimumStockLevel || 5,
    costPerUnit: costPerUnit || 0,
    quantityAvailable: quantityAvailable || 0,
    lastRestockedAt: quantityAvailable ? new Date() : null,
    createdBy: user._id,
  });

  return item;
};

/*
  Add Stock (IN)
*/
exports.addStock = async (data, user) => {
  requirePermission(user, "ACCESS_INVENTORY");

  const { itemId, quantity, note } = data;

  if (!itemId || !quantity || quantity <= 0) {
    throw new Error("Invalid stock data");
  }

  const item = await InventoryItem.findOne({ itemId });

  if (!item) {
    throw new Error("Item not found");
  }

  // Update quantity
  item.quantityAvailable += quantity;
  item.lastRestockedAt = new Date();
  await item.save();

  // Log movement
  await StockMovement.create({
    itemId,
    organizationId: item.organizationId,
    branchId: item.branchId,
    type: "IN",
    quantity,
    note,
    createdBy: user._id,
  });

  return item;
};

/*
  Remove Stock (OUT)
*/
exports.removeStock = async (data, user) => {
  requirePermission(user, "ACCESS_INVENTORY");

  const { itemId, quantity, note } = data;

  if (!itemId || !quantity || quantity <= 0) {
    throw new Error("Invalid stock data");
  }

  const item = await InventoryItem.findOne({ itemId });

  if (!item) {
    throw new Error("Item not found");
  }

  if (quantity > item.quantityAvailable) {
    throw new Error("Insufficient stock");
  }

  item.quantityAvailable -= quantity;
  await item.save();

  await StockMovement.create({
    itemId,
    organizationId: item.organizationId,
    branchId: item.branchId,
    type: "OUT",
    quantity,
    note,
    createdBy: user.userId,
  });

  return item;
};

/*
  Get Inventory with Stock Status
*/
exports.getInventory = async (user) => {
  requirePermission(user, "ACCESS_INVENTORY");

  console.log("ACTIVE BRANCH ID:", user.branchId);

  // 🔥 Branch mandatory for inventory access
  if (!user.branchId) {
    throw new Error("No active branch selected");
  }

  const filter = {
    isActive: true,
    branchId: user.branchId, // ✅ ALWAYS filter by active branch
  };

  const items = await InventoryItem.find(filter).sort({
    createdAt: -1,
  });

  return items.map((item) => ({
    ...item.toObject(),
    stockStatus:
      item.quantityAvailable === 0
        ? "OUT_OF_STOCK"
        : item.quantityAvailable <= item.minimumStockLevel
          ? "LOW_STOCK"
          : "IN_STOCK",
  }));
};

/*
  Get Inventory Summary
*/
exports.getInventorySummary = async (user) => {
  requirePermission(user, "ACCESS_INVENTORY");

  if (!user.branchId) {
    throw new Error("No active branch selected");
  }

  // 🔥 STRICT branch-level filtering
  const items = await InventoryItem.find({
    isActive: true,
    branchId: user.branchId,
  });

  let totalItems = items.length;
  let lowStockAlerts = 0;
  let totalStockValue = 0;
  const categoriesSet = new Set();

  items.forEach((item) => {
    if (item.category) {
      categoriesSet.add(item.category);
    }

    totalStockValue += item.quantityAvailable * item.costPerUnit;

    const minLevel =
      typeof item.minimumStockLevel === "number"
        ? item.minimumStockLevel
        : 5;

    if (item.quantityAvailable <= minLevel) {
      lowStockAlerts++;
    }
  });

  return {
    totalItems,
    lowStockAlerts,
    totalStockValue,
    totalCategories: categoriesSet.size,
  };
};
