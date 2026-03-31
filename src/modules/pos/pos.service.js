const POSItem = require("./posItem.model");
const POSOrder = require("./posOrder.model");
const Invoice = require("../invoice/invoice.model");
const { getIO } = require("../../config/socket");
const POSCategory = require("./posCategory.model");
const POSTable = require("./posTable.model");
const Branch = require("../branch/branch.model");
const Room = require("../room/room.model");
const Booking = require("../booking/booking.model");
const MergedInvoice = require("../finance/mergedInvoice.model");
const branchSettingsService = require("../branchSettings/branchSettings.service");
const notificationService = require("../notification/notification.service");
const mongoose = require("mongoose");

const ACTIVE_ORDER_STATUSES = [
  "OPEN",
  "PREPARING",
  "READY",
  "SERVED",
  "IN_PROGRESS",
];
const CLOSING_ORDER_STATUSES = ["COMPLETED", "CANCELLED"];

function requirePermission(user, permission) {
  if (!user) {
    const error = new Error("Unauthorized user");
    error.statusCode = 401;
    throw error;
  }

  if (user.isPlatformAdmin || user.role === "SUPER_ADMIN") {
    return true;
  }

  if (user.role === "CORPORATE_ADMIN") {
    return true;
  }

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

const roundCurrency = (value) => Number(Number(value || 0).toFixed(2));

const ORDER_TYPE_LABELS = {
  DINE_IN: "Dine-in",
  ROOM_SERVICE: "Room Service",
  TAKEAWAY: "Takeaway",
};

const normalizeOrderStatus = (status) => {
  if (!status) return "OPEN";

  const normalized = String(status).toUpperCase();
  return normalized === "IN_PROGRESS" ? "PREPARING" : normalized;
};

const emitOrderUpdate = (eventName, branchId, payload) => {
  const io = getIO();
  const aliasEventName =
    eventName === "new-order"
      ? "ORDER_CREATED"
      : eventName === "order-updated"
        ? "ORDER_UPDATED"
        : null;

  io.to(`branch_${branchId}`).emit(eventName, payload);
  io.to(`branch-${branchId}`).emit(eventName, payload);

  if (aliasEventName) {
    io.to(`branch_${branchId}`).emit(aliasEventName, payload);
    io.to(`branch-${branchId}`).emit(aliasEventName, payload);
  }
};

const resolveOrganizationContext = async (user) => {
  let organizationId = user.organizationId;
  let branchId = user.branchId;

  if (!branchId) {
    throw new Error("No active branch selected");
  }

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
    throw new Error("Organization ID missing");
  }

  return { organizationId, branchId };
};

const syncTableOccupancy = async (tableId, session = null) => {
  if (!tableId) return null;

  const existsQuery = POSOrder.exists({
    tableId,
    orderStatus: { $in: ACTIVE_ORDER_STATUSES },
    isActive: true,
  });

  if (session) {
    existsQuery.session(session);
  }

  const activeOrderExists = await existsQuery;

  const updateOptions = session ? { new: true, session } : { new: true };

  return POSTable.findByIdAndUpdate(
    tableId,
    { status: activeOrderExists ? "OCCUPIED" : "AVAILABLE" },
    updateOptions,
  );
};

const resolveCheckedInBookingForRoom = async (roomId, branchId, session = null) => {
  const bookingQuery = Booking.findOne({
    roomId,
    branchId,
    status: "CHECKED_IN",
    isActive: true,
  })
    .sort({ createdAt: -1 })
    .select(
      "_id bookingId guestName invoiceId organizationId branchId roomId nights",
    );

  if (session) {
    bookingQuery.session(session);
  }

  return bookingQuery;
};

const getInvoiceGuestName = ({ orderType, booking, tableNumber }) => {
  if (orderType === "ROOM_SERVICE") {
    return booking?.guestName || "Guest";
  }

  if (orderType === "TAKEAWAY") {
    return "Takeaway Guest";
  }

  const normalizedTableName = String(tableNumber || "").trim();
  return normalizedTableName ? normalizedTableName : "Walk-in Guest";
};

const resolveBookingForRoomServiceOrder = async ({ order, session = null }) => {
  if (!order.roomId || !order.bookingId) {
    return null;
  }

  const bookingQuery = Booking.findOne({
    bookingId: order.bookingId,
    roomId: order.roomId,
    branchId: order.branchId,
    isActive: true,
  });

  if (session) {
    bookingQuery.session(session);
  }

  return bookingQuery;
};

const ensureRoomInvoiceExists = async ({ booking, user, session }) => {
  const invoiceQuery = Invoice.findOne({
    bookingId: booking._id,
    referenceType: "BOOKING",
    isActive: true,
  });

  if (session) {
    invoiceQuery.session(session);
  }

  let invoice = await invoiceQuery;

  if (invoice) {
    return invoice;
  }

  const roomQuery = Room.findById(booking.roomId);

  if (session) {
    roomQuery.session(session);
  }

  const room = await roomQuery;

  if (!room) {
    throw new Error("Room not found for checked-in booking");
  }

  const financialSettings =
    await branchSettingsService.getFinancialSettingsByBranchId(booking.branchId);
  const roomCharges = roundCurrency(
    Number(booking.nights || 0) * Number(room.pricePerNight || 0),
  );
  const taxAmount = roundCurrency(
    (roomCharges * Number(financialSettings.taxPercentage || 0)) / 100,
  );
  const finalAmount = roundCurrency(roomCharges + taxAmount);

  const createdInvoices = await Invoice.create(
    [
      {
        organizationId: booking.organizationId,
        branchId: booking.branchId,
        bookingId: booking._id,
        guestName: booking.guestName || "",
        orderType: "ROOM_SERVICE",
        type: "ROOM",
        referenceType: "BOOKING",
        referenceId: booking.bookingId,
        lineItems: [
          {
            description: "Room Charges",
            quantity: booking.nights,
            unitPrice: room.pricePerNight,
            total: roomCharges,
          },
        ],
        totalAmount: roomCharges,
        taxAmount,
        serviceChargeAmount: 0,
        discountAmount: 0,
        finalAmount,
        paidAmount: 0,
        dueAmount: finalAmount,
        status: "UNPAID",
        createdBy: user._id,
        updatedBy: user._id,
      },
    ],
    { session },
  );

  invoice = createdInvoices[0];
  booking.invoiceId = invoice._id;
  await booking.save({ session });

  return invoice;
};

const attachRoomServiceToInvoice = async ({ order, booking, user, session }) => {
  const invoice = await ensureRoomInvoiceExists({ booking, user, session });

  invoice.guestName = booking?.guestName || invoice.guestName || "Guest";
  invoice.orderType = "ROOM_SERVICE";

  invoice.lineItems.push({
    description: `Room Service ${order.orderCode}`,
    quantity: 1,
    unitPrice: order.grandTotal,
    total: order.grandTotal,
  });
  invoice.totalAmount = roundCurrency(
    Number(invoice.totalAmount || 0) + Number(order.grandTotal || 0),
  );
  invoice.finalAmount = roundCurrency(
    Number(invoice.finalAmount || 0) + Number(order.grandTotal || 0),
  );
  invoice.dueAmount = roundCurrency(
    Math.max(Number(invoice.finalAmount || 0) - Number(invoice.paidAmount || 0), 0),
  );
  invoice.status =
    invoice.dueAmount === 0
      ? "PAID"
      : Number(invoice.paidAmount || 0) > 0
        ? "PARTIALLY_PAID"
        : "UNPAID";
  invoice.updatedBy = user._id;
  await invoice.save({ session });

  await MergedInvoice.findOneAndUpdate(
    { bookingId: booking._id },
    {
      $setOnInsert: {
        organizationId: booking.organizationId,
        branchId: booking.branchId,
        bookingId: booking._id,
        roomInvoiceId: invoice._id,
        createdBy: user._id,
      },
      $addToSet: { posOrderIds: order._id },
      $inc: { totalAmount: order.grandTotal },
    },
    { upsert: true, new: true, session },
  );

  order.invoiceLinked = true;
  order.invoiceId = invoice.invoiceId;
  await order.save({ session });

  return invoice;
};

const createRestaurantInvoiceForOrder = async ({ order, booking, user, session = null }) => {
  if (order.invoiceLinked && order.invoiceId) {
    const existingInvoice = await Invoice.findOne({
      invoiceId: order.invoiceId,
      isActive: true,
    });

    if (existingInvoice) {
      return existingInvoice;
    }
  }

  const guestName = getInvoiceGuestName({
    orderType: order.orderType,
    booking: booking || (order.guestName ? { guestName: order.guestName } : null),
    tableNumber: order.tableNumber,
  });

  const lineItems = (order.items || []).map((item) => ({
    description: item.nameSnapshot || "Menu Item",
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.priceSnapshot || 0),
    total: Number(item.totalItemAmount || 0),
  }));

  const invoicePayload = {
    organizationId: order.organizationId,
    branchId: order.branchId,
    type: "RESTAURANT",
    referenceType: "POS",
    referenceId: order.orderId,
    bookingId: booking?._id || null,
    guestName,
    orderType: order.orderType,
    lineItems,
    totalAmount: order.subTotal,
    taxAmount: order.totalTax,
    serviceChargeAmount: order.totalServiceCharge,
    discountAmount: order.discountAmount,
    finalAmount: order.grandTotal,
    status: "PAID",
    paidAmount: order.grandTotal,
    dueAmount: 0,
    paymentHistory: order.paymentMethod
      ? [
          {
            amount: order.grandTotal,
            method: order.paymentMethod,
            recordedBy: user._id,
            paidAt: new Date(),
          },
        ]
      : [],
    createdBy: user._id,
    updatedBy: user._id,
  };

  const createdInvoice = session
    ? (await Invoice.create([invoicePayload], { session }))[0]
    : await Invoice.create(invoicePayload);

  order.invoiceLinked = true;
  order.invoiceId = createdInvoice.invoiceId;

  if (session) {
    await order.save({ session });
  } else {
    await order.save();
  }

  return createdInvoice;
};

const ensureCompletedOrderInvoice = async ({ order, user, session = null }) => {
  if (order.paymentStatus !== "PAID" || order.orderStatus !== "COMPLETED") {
    return null;
  }

  if (order.orderType === "ROOM_SERVICE") {
    const booking = await resolveBookingForRoomServiceOrder({ order, session });

    if (!booking) {
      return null;
    }

    return createRestaurantInvoiceForOrder({
      order,
      booking,
      user,
      session,
    });
  }

  return createRestaurantInvoiceForOrder({
    order,
    booking: null,
    user,
    session,
  });
};

exports.createOrder = async (data, user) => {
  requirePermission(user, "ACCESS_POS");

  const {
    items,
    orderType,
    roomId,
    tableId,
    tableNumber,
    bookingId,
    status,
    discountAmount: incomingDiscountAmount = 0,
    discountPercentage: incomingDiscountPercentage = 0,
  } = data;

  if (!items || items.length === 0) {
    throw new Error("Order must contain items");
  }

  const { organizationId, branchId } = await resolveOrganizationContext(user);

  const branch = await Branch.findById(branchId).select("name").lean();

  if (!branch) {
    throw new Error("Branch not found");
  }

  const branchPrefix = branch.name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  const lastOrder = await POSOrder.findOne({ branchId })
    .sort({ orderNumber: -1 })
    .select("orderNumber")
    .lean();

  const nextOrderNumber = lastOrder ? lastOrder.orderNumber + 1 : 1;
  const financialSettings =
    await branchSettingsService.getFinancialSettingsByBranchId(branchId);

  let subTotal = 0;
  const orderItems = [];

  for (const item of items) {
    const menuItem = await POSItem.findOne({ itemId: item.itemId });

    if (!menuItem || !menuItem.isAvailable) {
      throw new Error("Item not available");
    }

    const itemTotal = roundCurrency(Number(menuItem.price || 0) * Number(item.quantity || 0));
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

  const normalizedOrderType = String(orderType || "").toUpperCase();

  if (!["DINE_IN", "ROOM_SERVICE", "TAKEAWAY"].includes(normalizedOrderType)) {
    throw new Error("Invalid order type");
  }

  const discountAmount = Math.max(Number(incomingDiscountAmount || 0), 0);
  const discountPercentage = Math.max(Number(incomingDiscountPercentage || 0), 0);
  const taxableBase = Math.max(subTotal - discountAmount, 0);
  const totalTax = roundCurrency(
    (taxableBase * Number(financialSettings.taxPercentage || 0)) / 100,
  );
  const totalServiceCharge = roundCurrency(
    (taxableBase * Number(financialSettings.serviceChargePercentage || 0)) / 100,
  );
  const grandTotal = roundCurrency(
    Math.max(taxableBase + totalTax + totalServiceCharge, 0),
  );

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let selectedTable = null;
    let selectedRoom = null;
    let activeBooking = null;

    if (normalizedOrderType === "DINE_IN") {
      const tableQuery = tableId
        ? { _id: tableId, branchId, isActive: true }
        : {
            branchId,
            isActive: true,
            $or: [{ tableNumber: tableNumber || null }, { name: tableNumber || null }],
          };

      selectedTable = await POSTable.findOne(tableQuery).session(session);

      if (!selectedTable) {
        throw new Error("Selected table not found");
      }

      const existingActiveOrder = await POSOrder.findOne({
        tableId: selectedTable._id,
        orderStatus: { $in: ACTIVE_ORDER_STATUSES },
        isActive: true,
      }).session(session);

      if (existingActiveOrder) {
        throw new Error("Only one active order is allowed per table");
      }
    }

    if (normalizedOrderType === "ROOM_SERVICE") {
      if (!roomId || !mongoose.Types.ObjectId.isValid(roomId)) {
        throw new Error("Checked-in room selection is required");
      }

      selectedRoom = await Room.findOne({
        _id: roomId,
        branchId,
        isActive: true,
      }).session(session);

      if (!selectedRoom) {
        throw new Error("Selected room not found");
      }

      activeBooking =
        (bookingId &&
          (await Booking.findOne({
            bookingId,
            roomId: selectedRoom._id,
            branchId,
            status: "CHECKED_IN",
            isActive: true,
          }).session(session))) ||
        (await resolveCheckedInBookingForRoom(selectedRoom._id, branchId, session));

      if (!activeBooking) {
        throw new Error("Only checked-in rooms can be used for room service");
      }
    }

    const createdOrders = await POSOrder.create(
      [
        {
          orderNumber: nextOrderNumber,
          orderCode: `${branchPrefix}-${String(nextOrderNumber).padStart(3, "0")}`,
          organizationId,
          branchId,
          tableId: selectedTable?._id || null,
          tableNumber:
            normalizedOrderType === "DINE_IN"
              ? selectedTable?.tableNumber || selectedTable?.name || tableNumber
              : null,
          roomId: selectedRoom?._id || null,
          bookingId:
            normalizedOrderType === "ROOM_SERVICE"
              ? activeBooking?.bookingId || bookingId || null
              : bookingId || null,
          guestName:
            normalizedOrderType === "ROOM_SERVICE"
              ? activeBooking?.guestName || ""
              : "",
          orderType: normalizedOrderType,
          items: orderItems,
          subTotal,
          totalTax,
          totalServiceCharge,
          discountAmount,
          discountPercentage,
          grandTotal,
          orderStatus: normalizeOrderStatus(status),
          createdBy: user._id,
        },
      ],
      { session },
    );

    const order = createdOrders[0];

    if (selectedTable) {
      selectedTable.status = "OCCUPIED";
      await selectedTable.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    emitOrderUpdate("new-order", branchId, order);

    await notificationService.createNotificationSafely({
      title: "New POS order created",
      message: `Order ${order.orderCode} was created for branch ${branch.name}.`,
      type: "pos",
      organizationId,
      branchId,
      module: "POS",
    });

    return order;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

exports.updateKitchenStatus = async (orderId, itemId, status, user) => {
  requirePermission(user, "ACCESS_POS");

  let order = await POSOrder.findOne({ orderId });

  if (!order && mongoose.Types.ObjectId.isValid(orderId)) {
    order = await POSOrder.findById(orderId);
  }

  if (!order) {
    throw new Error("Order not found");
  }

  const item = order.items.find((entry) => entry.itemId === itemId);

  if (!item) {
    throw new Error("Item not found in order");
  }

  item.kitchenStatus = status;
  await order.save();

  emitOrderUpdate("order-updated", order.branchId, order);

  return order;
};

exports.completeOrder = async (orderId, user) => {
  requirePermission(user, "ACCESS_POS");

  const order = await POSOrder.findOne({ orderId });

  if (!order) {
    throw new Error("Order not found");
  }

  order.orderStatus = "COMPLETED";

  if (
    order.paymentStatus === "PAID" &&
    (!order.invoiceLinked || !order.invoiceId)
  ) {
    const invoice = await ensureCompletedOrderInvoice({ order, user });

    if (invoice) {
      await notificationService.createNotificationSafely({
        title: "Restaurant invoice generated",
        message: `Invoice ${invoice.invoiceId} was generated for order ${order.orderCode}.`,
        type: "invoice",
        organizationId: order.organizationId,
        branchId: order.branchId,
        module: "FINANCE",
      });
    } else {
      await order.save();
    }
  } else {
    await order.save();
  }

  await syncTableOccupancy(order.tableId);

  emitOrderUpdate("order-updated", order.branchId, order);

  return order;
};

exports.updateOrderStatus = async (orderId, status, user) => {
  requirePermission(user, "ACCESS_POS");

  const normalizedStatus = normalizeOrderStatus(status);
  const allowedStatuses = [...ACTIVE_ORDER_STATUSES, ...CLOSING_ORDER_STATUSES];

  if (!allowedStatuses.includes(normalizedStatus)) {
    throw new Error("Invalid order status");
  }

  let order = await POSOrder.findOne({ orderId });

  if (!order && mongoose.Types.ObjectId.isValid(orderId)) {
    order = await POSOrder.findById(orderId);
  }

  if (!order) {
    throw new Error("Order not found");
  }

  order.orderStatus = normalizedStatus;

  let invoice = null;

  if (
    normalizedStatus === "COMPLETED" &&
    order.paymentStatus === "PAID" &&
    (!order.invoiceLinked || !order.invoiceId)
  ) {
    invoice = await ensureCompletedOrderInvoice({ order, user });
  }

  if (!invoice) {
    await order.save();
  }

  if (order.tableId) {
    await syncTableOccupancy(order.tableId);
  }

  emitOrderUpdate("order-updated", order.branchId, order);

  if (invoice) {
    await notificationService.createNotificationSafely({
      title: "Restaurant invoice generated",
      message: `Invoice ${invoice.invoiceId} was generated for order ${order.orderCode}.`,
      type: "invoice",
      organizationId: order.organizationId,
      branchId: order.branchId,
      module: "FINANCE",
    });
  }

  return order;
};

exports.payOrder = async (orderId, paymentMethod, user) => {
  requirePermission(user, "ACCESS_POS");

  const order = await POSOrder.findOne({ orderId });

  if (!order) {
    throw new Error("Order not found");
  }

  if (order.paymentStatus === "PAID") {
    throw new Error("Already paid");
  }

  order.paymentStatus = "PAID";
  order.paymentMethod = paymentMethod;
  await order.save();

  let invoice = null;

  if (order.orderStatus === "COMPLETED") {
    const booking =
      order.orderType === "ROOM_SERVICE"
        ? await resolveBookingForRoomServiceOrder({ order })
        : null;

    invoice = await createRestaurantInvoiceForOrder({
      order,
      booking,
      user,
    });
  }

  if (invoice) {
    await notificationService.createNotificationSafely({
      title: "Restaurant invoice generated",
      message: `Invoice ${invoice.invoiceId} was generated for order ${order.orderCode}.`,
      type: "invoice",
      organizationId: order.organizationId,
      branchId: order.branchId,
      module: "FINANCE",
    });

    order.invoiceLinked = true;
    order.invoiceId = invoice.invoiceId;
    await order.save();
  }

  emitOrderUpdate("order-updated", order.branchId, order);

  return order;
};

exports.createCategory = async (data, user) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId } = await resolveOrganizationContext(user);

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

exports.getCategories = async (user) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);

  return POSCategory.find({
    organizationId,
    branchId,
    isActive: true,
  }).sort({ displayOrder: 1 });
};

exports.updateCategory = async (categoryId, data, user) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);

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

exports.deleteCategory = async (categoryId, user) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);

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

exports.createItem = async (data, user) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);

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

exports.getItems = async (user) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);

  return POSItem.find({
    organizationId,
    branchId,
    isActive: true,
  }).sort({ displayOrder: 1 });
};

exports.updateItem = async (itemId, data, user) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);

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

exports.deleteItem = async (itemId, user) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);

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

exports.createTable = async (data, user) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);

  const table = await POSTable.create({
    organizationId,
    branchId,
    tableNumber: data.tableNumber || data.name,
    name: data.name || data.tableNumber,
    seats: data.seats || 2,
    tableType: data.tableType || "REGULAR",
    location: data.location,
    displayOrder: data.displayOrder || 0,
    createdBy: user._id,
  });

  return table;
};

exports.getTables = async (user, filters = {}) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);
  const targetBranchId = filters.branchId || branchId;

  const tables = await POSTable.find({
    organizationId,
    branchId: targetBranchId,
    isActive: true,
  }).sort({ displayOrder: 1 });

  const tableIds = tables.map((table) => table._id);
  const activeOrders = await POSOrder.find({
    tableId: { $in: tableIds },
    orderStatus: { $in: ACTIVE_ORDER_STATUSES },
    isActive: true,
  })
    .select("tableId")
    .lean();

  const occupiedTableIds = new Set(activeOrders.map((order) => String(order.tableId)));

  return tables.map((table) => ({
    ...table.toObject(),
    tableNumber: table.tableNumber || table.name,
    status: occupiedTableIds.has(String(table._id)) ? "OCCUPIED" : "AVAILABLE",
  }));
};

exports.getOrders = async (user, filters = {}) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);

  const query = {
    organizationId,
    branchId,
    isActive: true,
  };

  if (filters.status) {
    query.orderStatus =
      String(filters.status).toUpperCase() === "ACTIVE"
        ? { $in: ACTIVE_ORDER_STATUSES }
        : normalizeOrderStatus(filters.status);
  }

  if (filters.type) {
    query.orderType = String(filters.type).toUpperCase();
  }

  return POSOrder.find(query)
    .sort({ createdAt: -1 })
    .populate("tableId", "name tableNumber")
    .populate("roomId", "roomNumber")
    .lean();
};

exports.getKitchenOrders = async (user) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);

  const orders = await POSOrder.find({
    organizationId,
    branchId,
    orderStatus: { $in: ACTIVE_ORDER_STATUSES },
  })
    .sort({ createdAt: -1 })
    .lean();

  return orders
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
};
