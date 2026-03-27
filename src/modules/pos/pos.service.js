const POSItem = require("./posItem.model");
const POSOrder = require("./posOrder.model");
const StockMovement = require("../inventory/stockMovement.model");
const Invoice = require("../invoice/invoice.model");
const { getIO } = require("../../config/socket");
const POSCategory = require("./posCategory.model");
const POSTable = require("./posTable.model");
const Branch = require("../branch/branch.model");
const branchSettingsService = require("../branchSettings/branchSettings.service");
const mongoose = require("mongoose");

/*
  Permission Helper
*/
function requirePermission(user, permission) {
  if (!user) {
    const error = new Error("Unauthorized user");
    error.statusCode = 401;
    throw error;
  }

  // SUPER ADMIN
  if (user.isPlatformAdmin || user.role === "SUPER_ADMIN") {
    return true;
  }

  // CORPORATE ADMIN
  if (user.role === "CORPORATE_ADMIN") {
    return true;
  }

  // BRANCH MANAGER
  if (user.role === "BRANCH_MANAGER") {
    return true;
  }

  if (!user.permissions || !user.permissions.includes(permission)) {
    const error = new Error("Permission denied");
    error.statusCode = 403;
    throw error;
  }

  return true;
}

/* ===========================
   CREATE ORDER
=========================== */
exports.createOrder = async (data, user) => {
  requirePermission(user, "ACCESS_POS");

  const {
    items,
    orderType,
    tableNumber,
    bookingId,
    discountAmount: incomingDiscountAmount = 0,
    discountPercentage: incomingDiscountPercentage = 0,
  } = data;

  if (!items || items.length === 0) {
    throw new Error("Order must contain items");
  }

  let organizationId = user.organizationId;
  let branchId = user.branchId;

  /* Resolve organization from branch if missing */
  if (!organizationId && branchId) {
    const branch = await Branch.findById(branchId)
      .select("organizationId branchId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  if (!organizationId) {
    throw new Error("Organization ID missing for POS order");
  }

  /* ===========================
   GENERATE BRANCH PREFIX
=========================== */

  const branch = await Branch.findById(branchId).select("name").lean();

  if (!branch) {
    throw new Error("Branch not found");
  }

  /* Example: "New York Hotel" → "NYH" */

  const branchPrefix = branch.name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  /* ===========================
     GENERATE SERIAL ORDER NUMBER
  ============================ */

  const lastOrder = await POSOrder.findOne({ branchId })
    .sort({ orderNumber: -1 })
    .select("orderNumber")
    .lean();

  const nextOrderNumber = lastOrder ? lastOrder.orderNumber + 1 : 1;

  let subTotal = 0;

  const financialSettings =
    await branchSettingsService.getFinancialSettingsByBranchId(branchId);

  const orderItems = [];

  for (let item of items) {
    const menuItem = await POSItem.findOne({ itemId: item.itemId });

    if (!menuItem || !menuItem.isAvailable) {
      throw new Error("Item not available");
    }

    const itemTotal = menuItem.price * item.quantity;

    subTotal += itemTotal;

    orderItems.push({
      itemId: menuItem.itemId,
      nameSnapshot: menuItem.name,
      priceSnapshot: menuItem.price,
      taxPercentageSnapshot: financialSettings.taxPercentage,
      serviceChargePercentageSnapshot: financialSettings.serviceChargePercentage,
      quantity: item.quantity,
      totalItemAmount: itemTotal,

      kitchenStatus: "PENDING",
      kitchenStation: menuItem.kitchenStation || "MAIN_KITCHEN",
    });
  }

  const discountAmount = Math.max(Number(incomingDiscountAmount || 0), 0);
  const discountPercentage = Math.max(
    Number(incomingDiscountPercentage || 0),
    0,
  );
  const taxableBase = Math.max(subTotal - discountAmount, 0);
  const totalTax = (taxableBase * financialSettings.taxPercentage) / 100;
  const totalServiceCharge =
    (taxableBase * financialSettings.serviceChargePercentage) / 100;
  const grandTotal = Math.max(
    taxableBase + totalTax + totalServiceCharge,
    0,
  );

  const order = await POSOrder.create({
    orderNumber: nextOrderNumber,
    orderCode: `${branchPrefix}-${String(nextOrderNumber).padStart(3, "0")}`,
    organizationId,
    branchId,
    orderType,
    tableNumber,
    bookingId,
    items: orderItems,
    subTotal,
    totalTax,
    totalServiceCharge,
    discountAmount,
    discountPercentage,
    grandTotal,
    createdBy: user._id,
  });

  /* REALTIME KITCHEN UPDATE */
  const io = getIO();
  io.to(`branch_${branchId}`).emit("new-order", order);

  return order;
};

/* ===========================
   UPDATE KITCHEN STATUS
=========================== */
exports.updateKitchenStatus = async (orderId, itemId, status, user) => {
  requirePermission(user, "ACCESS_POS");

  let order = null;

  // Try UUID orderId first
  order = await POSOrder.findOne({ orderId });

  // If not found, try Mongo _id
  if (!order && mongoose.Types.ObjectId.isValid(orderId)) {
    order = await POSOrder.findById(orderId);
  }

  if (!order) {
    throw new Error("Order not found");
  }

  if (!order) throw new Error("Order not found");

  const item = order.items.find((i) => i.itemId === itemId);

  if (!item) throw new Error("Item not found in order");

  item.kitchenStatus = status;

  await order.save();

  /* 🔥 Emit Order Update */
  const io = getIO();
  io.to(`branch-${order.branchId}`).emit("order-updated", order);

  return order;
};

/* ===========================
   COMPLETE ORDER
=========================== */
exports.completeOrder = async (orderId, user) => {
  requirePermission(user, "ACCESS_POS");

  const order = await POSOrder.findOne({ orderId });

  if (!order) throw new Error("Order not found");

  order.orderStatus = "COMPLETED";

  await order.save();

  /* 🔥 Emit Order Update */
  const io = getIO();
  io.to(`branch-${order.branchId}`).emit("order-updated", order);

  return order;
};

/* ===========================
   PAY ORDER
=========================== */
exports.payOrder = async (orderId, paymentMethod, user) => {
  requirePermission(user, "ACCESS_POS");

  const order = await POSOrder.findOne({ orderId });

  if (!order) throw new Error("Order not found");

  if (order.paymentStatus === "PAID") {
    throw new Error("Already paid");
  }

  order.paymentStatus = "PAID";
  order.paymentMethod = paymentMethod;

  await order.save();

  /* Optional: Generate Invoice */
  const invoice = await Invoice.create({
    organizationId: order.organizationId,
    branchId: order.branchId,
    type: "RESTAURANT",
    referenceType: "POS",
    referenceId: order.orderId,

    // FIX: only attach bookingId if it exists
    bookingId: order.bookingId ? order.bookingId : null,

    totalAmount: order.subTotal,
    taxAmount: order.totalTax,
    serviceChargeAmount: order.totalServiceCharge,
    discountAmount: order.discountAmount,
    finalAmount: order.grandTotal,

    status: "PAID",
    paidAmount: order.grandTotal,
    dueAmount: 0,

    createdBy: user._id,
  });

  order.invoiceLinked = true;
  order.invoiceId = invoice.invoiceId;
  await order.save();

  /* 🔥 Emit Order Update */
  const io = getIO();
  io.to(`branch-${order.branchId}`).emit("order-updated", order);

  return order;
};

/***********************
  Create Category
***********************/
exports.createCategory = async (data, user) => {
  requirePermission(user, "ACCESS_POS");

  let organizationId = user.organizationId;

  if (!organizationId && user.branchId) {
    const branch = await Branch.findById(user.branchId)
      .select("organizationId branchId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  const category = await POSCategory.create({
    organizationId,
    branchId: user.branchId,
    name: data.name,
    description: data.description,
    type: data.type || "FOOD",
    displayOrder: data.displayOrder || 0,
    image: data.image || null,
    color: data.color || "#C9A54C",
    createdBy: user._id,
  });

  return category;
};

/***********************
  Get Categories
***********************/
exports.getCategories = async (user) => {
  requirePermission(user, "ACCESS_POS");

  let organizationId = user.organizationId;
  let branchId = user.branchId;

  // 🔥 resolve organization from branch (super admin case)
  if (!organizationId && branchId) {
    const branch = await Branch.findById(branchId)
      .select("organizationId branchId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  return await POSCategory.find({
    organizationId,
    branchId,
    isActive: true,
  }).sort({ displayOrder: 1 });
};

/***********************
  Update Category
***********************/
exports.updateCategory = async (categoryId, data, user) => {
  requirePermission(user, "ACCESS_POS");

  let organizationId = user.organizationId;
  let branchId = user.branchId;

  if (!organizationId && branchId) {
    const branch = await Branch.findById(branchId)
      .select("organizationId branchId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  const category = await POSCategory.findOne({
    categoryId,
    organizationId,
    branchId,
    isActive: true,
  });

  if (!category) {
    throw new Error("Category not found");
  }

  category.name = data.name ?? category.name;
  category.description = data.description ?? category.description;
  category.type = data.type ?? category.type;

  await category.save();

  return category;
};

/***********************
  Delete Category
***********************/
exports.deleteCategory = async (categoryId, user) => {
  requirePermission(user, "ACCESS_POS");

  let organizationId = user.organizationId;
  let branchId = user.branchId;

  if (!organizationId && branchId) {
    const branch = await Branch.findById(branchId)
      .select("organizationId branchId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  const category = await POSCategory.findOne({
    categoryId,
    organizationId,
    branchId,
    isActive: true,
  });

  if (!category) {
    throw new Error("Category not found");
  }

  const activeItems = await POSItem.countDocuments({
    organizationId,
    branchId,
    categoryId,
    isActive: true,
  });

  if (activeItems > 0) {
    throw new Error("Delete menu items in this category before deleting it");
  }

  category.isActive = false;
  await category.save();

  return category;
};

/***********************
  Create Menu Item
***********************/
exports.createItem = async (data, user) => {
  requirePermission(user, "ACCESS_POS");

  let organizationId = user.organizationId;
  let branchId = user.branchId;

  // 🔥 resolve organization from branch (super admin case)
  if (!organizationId && branchId) {
    const branch = await Branch.findById(branchId)
      .select("organizationId branchId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  const item = await POSItem.create({
    organizationId,
    branchId,
    categoryId: data.categoryId,
    name: data.name,
    description: data.description,
    price: data.price,
    taxPercentage: data.taxPercentage || 0,
    serviceChargePercentage: data.serviceChargePercentage || 0,
    preparationTimeMinutes: data.preparationTimeMinutes || 10,
    kitchenStation: data.kitchenStation || "MAIN_KITCHEN",
    imageUrl: data.imageUrl || null,
    displayOrder: data.displayOrder || 0,
    createdBy: user._id,
  });

  return item;
};

/***********************
  Get Menu Items
***********************/
exports.getItems = async (user) => {
  requirePermission(user, "ACCESS_POS");

  let organizationId = user.organizationId;
  let branchId = user.branchId;

  // 🔥 resolve organization from branch (super admin case)
  if (!organizationId && branchId) {
    const branch = await Branch.findById(branchId)
      .select("organizationId branchId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  return await POSItem.find({
    organizationId,
    branchId,
    isActive: true,
  }).sort({ displayOrder: 1 });
};

/***********************
  Update Menu Item
***********************/
exports.updateItem = async (itemId, data, user) => {
  requirePermission(user, "ACCESS_POS");

  let organizationId = user.organizationId;
  let branchId = user.branchId;

  if (!organizationId && branchId) {
    const branch = await Branch.findById(branchId)
      .select("organizationId branchId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  const item = await POSItem.findOne({
    itemId,
    organizationId,
    branchId,
    isActive: true,
  });

  if (!item) {
    throw new Error("Menu item not found");
  }

  item.name = data.name ?? item.name;
  item.categoryId = data.categoryId ?? item.categoryId;
  item.description = data.description ?? item.description;
  item.price = data.price ?? item.price;
  item.preparationTimeMinutes =
    data.preparationTimeMinutes ?? item.preparationTimeMinutes;
  item.kitchenStation = data.kitchenStation ?? item.kitchenStation;

  await item.save();

  return item;
};

/***********************
  Delete Menu Item
***********************/
exports.deleteItem = async (itemId, user) => {
  requirePermission(user, "ACCESS_POS");

  let organizationId = user.organizationId;
  let branchId = user.branchId;

  if (!organizationId && branchId) {
    const branch = await Branch.findById(branchId)
      .select("organizationId branchId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  const item = await POSItem.findOne({
    itemId,
    organizationId,
    branchId,
    isActive: true,
  });

  if (!item) {
    throw new Error("Menu item not found");
  }

  item.isActive = false;
  await item.save();

  return item;
};

/***********************
  Create Table
***********************/
exports.createTable = async (data, user) => {
  requirePermission(user, "ACCESS_POS");

  let organizationId = user.organizationId;
  let branchId = user.branchId;

  // 🔥 resolve organization from branch (super admin case)
  if (!organizationId && branchId) {
    const branch = await Branch.findById(branchId)
      .select("organizationId branchId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  const table = await POSTable.create({
    organizationId,
    branchId,
    name: data.name,
    seats: data.seats || 2,
    tableType: data.tableType || "REGULAR",
    location: data.location,
    displayOrder: data.displayOrder || 0,
    createdBy: user._id,
  });

  return table;
};

/***********************
  Get Tables
***********************/
exports.getTables = async (user) => {
  requirePermission(user, "ACCESS_POS");

  let organizationId = user.organizationId;
  let branchId = user.branchId;

  // 🔥 resolve organization from branch (super admin case)
  if (!organizationId && branchId) {
    const branch = await Branch.findById(branchId)
      .select("organizationId branchId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  return await POSTable.find({
    organizationId,
    branchId,
    isActive: true,
  }).sort({ displayOrder: 1 });
};

/* ===========================
   GET KITCHEN ORDERS
=========================== */
exports.getKitchenOrders = async (user) => {
  requirePermission(user, "ACCESS_POS");

  let organizationId = user.organizationId;
  let branchId = user.branchId;

  if (!organizationId && branchId) {
    const branch = await Branch.findById(branchId)
      .select("organizationId")
      .lean();

    if (!branch) {
      throw new Error("Branch not found");
    }

    organizationId = branch.organizationId;
  }

  const orders = await POSOrder.find({
    organizationId,
    branchId,
    orderStatus: "OPEN",
  })
    .sort({ createdAt: -1 })
    .lean();

  // 🔥 filter only active kitchen items
  const filteredOrders = orders
    .map((order) => ({
      ...order,
      items: order.items.filter(
        (item) =>
          item.kitchenStatus === "PENDING" ||
          item.kitchenStatus === "PREPARING" ||
          item.kitchenStatus === "READY",
      ),
    }))
    .filter((order) => order.items.length > 0);

  return filteredOrders;
};
