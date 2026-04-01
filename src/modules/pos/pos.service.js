const POSItem = require("./posItem.model");
const POSOrder = require("./posOrder.model");
const POSSession = require("./posSession.model");
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

const SESSION_ACTIVE_STATUSES = ["OPEN", "BILL_REQUESTED", "PAID"];
const SESSION_KITCHEN_ORDER_STATUSES = ["PLACED", "PREPARING", "READY"];
const SESSION_ORDER_ACTIVE_STATUSES = [
  "PLACED",
  "OPEN",
  "PREPARING",
  "READY",
  "SERVED",
  "IN_PROGRESS",
];

const normalizeSessionOrderStatus = (status) => {
  if (!status) return "PLACED";

  const normalized = String(status).toUpperCase();

  if (normalized === "OPEN") return "PLACED";
  if (normalized === "IN_PROGRESS") return "PREPARING";
  if (normalized === "COMPLETED") return "SERVED";

  return normalized;
};

const normalizeSessionStatus = (status) => {
  const normalized = String(status || "OPEN").toUpperCase();
  return ["OPEN", "BILL_REQUESTED", "PAID", "CLOSED"].includes(normalized)
    ? normalized
    : "OPEN";
};

const emitSessionUpdate = (branchId, payload) => {
  const io = getIO();
  io.to(`branch_${branchId}`).emit("session-updated", payload);
  io.to(`branch-${branchId}`).emit("session-updated", payload);
};

const syncTableOccupancyFromSessions = async (tableId, dbSession = null) => {
  if (!tableId) return null;

  const existsQuery = POSSession.exists({
    tableId,
    status: { $in: SESSION_ACTIVE_STATUSES },
    isActive: true,
  });

  if (dbSession) {
    existsQuery.session(dbSession);
  }

  const isOccupied = await existsQuery;
  const updateOptions = dbSession ? { new: true, session: dbSession } : { new: true };

  return POSTable.findByIdAndUpdate(
    tableId,
    { status: isOccupied ? "OCCUPIED" : "AVAILABLE" },
    updateOptions,
  );
};

const deriveSessionOrderStatusFromItems = (items = []) => {
  if (!items.length) return "PLACED";

  const statuses = items.map((item) => String(item.kitchenStatus || "PENDING").toUpperCase());

  if (statuses.every((status) => status === "SERVED")) return "SERVED";
  if (statuses.every((status) => status === "READY" || status === "SERVED")) return "READY";
  if (statuses.some((status) => status === "PREPARING")) return "PREPARING";
  return "PLACED";
};

const mergeSessionItems = (orders = []) => {
  const mergedMap = new Map();

  for (const order of orders) {
    for (const item of order.items || []) {
      const key = [
        item.itemId,
        item.nameSnapshot || "Menu Item",
        Number(item.priceSnapshot || 0),
      ].join("|");

      const existing = mergedMap.get(key);

      if (existing) {
        existing.quantity += Number(item.quantity || 0);
        existing.total += Number(item.totalItemAmount || 0);
      } else {
        mergedMap.set(key, {
          itemId: item.itemId,
          description: item.nameSnapshot || "Menu Item",
          quantity: Number(item.quantity || 0),
          unitPrice: Number(item.priceSnapshot || 0),
          total: Number(item.totalItemAmount || 0),
        });
      }
    }
  }

  return Array.from(mergedMap.values()).map((item) => ({
    ...item,
    total: roundCurrency(item.total),
  }));
};

const buildSessionSummary = (sessionRecord, orders = [], invoice = null) => ({
  ...(typeof sessionRecord.toObject === "function" ? sessionRecord.toObject() : sessionRecord),
  orders,
  orderCount: orders.length,
  runningTotal: roundCurrency(
    orders
      .filter((order) => order.orderStatus !== "CANCELLED")
      .reduce((sum, order) => sum + Number(order.grandTotal || 0), 0),
  ),
  invoice,
});

const getSessionOrders = async (sessionId, branchId) =>
  POSOrder.find({
    sessionId,
    branchId,
    isActive: true,
  })
    .sort({ createdAt: 1 })
    .populate("tableId", "name tableNumber")
    .populate("roomId", "roomNumber")
    .lean();

const resolvePOSSessionTarget = async ({ data, branchId, dbSession = null }) => {
  const normalizedType = String(data.type || data.orderType || "").toUpperCase();

  if (!["DINE_IN", "ROOM_SERVICE", "TAKEAWAY"].includes(normalizedType)) {
    throw new Error("Invalid session/order type");
  }

  let selectedTable = null;
  let selectedRoom = null;
  let activeBooking = null;

  if (normalizedType === "DINE_IN") {
    const tableQuery = data.tableId
      ? { _id: data.tableId, branchId, isActive: true }
      : {
          branchId,
          isActive: true,
          $or: [{ tableNumber: data.tableNo || data.tableNumber }, { name: data.tableNo || data.tableNumber }],
        };

    const query = POSTable.findOne(tableQuery);

    if (dbSession) {
      query.session(dbSession);
    }

    selectedTable = await query;

    if (!selectedTable) {
      throw new Error("Selected table not found");
    }
  }

  if (normalizedType === "ROOM_SERVICE") {
    if (!data.roomId || !mongoose.Types.ObjectId.isValid(data.roomId)) {
      throw new Error("Checked-in room selection is required");
    }

    const roomQuery = Room.findOne({
      _id: data.roomId,
      branchId,
      isActive: true,
    });

    if (dbSession) {
      roomQuery.session(dbSession);
    }

    selectedRoom = await roomQuery;

    if (!selectedRoom) {
      throw new Error("Selected room not found");
    }

    if (data.bookingId) {
      const bookingQuery = Booking.findOne({
        bookingId: data.bookingId,
        roomId: selectedRoom._id,
        branchId,
        status: "CHECKED_IN",
        isActive: true,
      });

      if (dbSession) {
        bookingQuery.session(dbSession);
      }

      activeBooking = await bookingQuery;
    }

    activeBooking =
      activeBooking ||
      (await resolveCheckedInBookingForRoom(selectedRoom._id, branchId, dbSession));

    if (!activeBooking) {
      throw new Error("Only checked-in rooms can be used for room service");
    }
  }

  if (normalizedType === "TAKEAWAY") {
    return {
      type: normalizedType,
      selectedTable: null,
      selectedRoom: null,
      activeBooking: null,
      tableNo: null,
      roomNo: null,
      guestName: String(data.guestName || "").trim(),
    };
  }

  return {
    type: normalizedType,
    selectedTable,
    selectedRoom,
    activeBooking,
    tableNo: selectedTable?.tableNumber || selectedTable?.name || data.tableNo || data.tableNumber || null,
    roomNo: selectedRoom?.roomNumber || data.roomNo || null,
    guestName: String(data.guestName || activeBooking?.guestName || "").trim(),
  };
};

const ensureOpenSessionRecord = async ({ data, user, dbSession = null }) => {
  const { organizationId, branchId } = await resolveOrganizationContext(user);

  if (data.sessionId) {
    const sessionQuery = POSSession.findOne({
      sessionId: data.sessionId,
      branchId,
      status: "OPEN",
      isActive: true,
    });

    if (dbSession) {
      sessionQuery.session(dbSession);
    }

    const existingById = await sessionQuery;

    if (!existingById) {
      throw new Error("Open session not found");
    }

    return existingById;
  }

  const target = await resolvePOSSessionTarget({ data, branchId, dbSession });
  const existingQuery = POSSession.findOne({
    branchId,
    type: target.type,
    status: "OPEN",
    isActive: true,
    ...(target.type === "DINE_IN"
      ? { tableId: target.selectedTable?._id || null }
      : target.type === "ROOM_SERVICE"
        ? { roomId: target.selectedRoom?._id || null }
        : { _id: null }),
  }).sort({ createdAt: -1 });

  if (dbSession) {
    existingQuery.session(dbSession);
  }

  const existingSession =
    target.type === "TAKEAWAY" ? null : await existingQuery;

  if (existingSession) {
    if (target.guestName && target.guestName !== existingSession.guestName) {
      existingSession.guestName = target.guestName;
      existingSession.updatedBy = user._id;
      await existingSession.save({ session: dbSession || undefined });
    }

    return existingSession;
  }

  const createdSessions = await POSSession.create(
    [
      {
        organizationId,
        branchId,
        type: target.type,
        tableId: target.selectedTable?._id || null,
        tableNo: target.tableNo,
        roomId: target.selectedRoom?._id || null,
        roomNo: target.roomNo,
        bookingId: target.activeBooking?.bookingId || data.bookingId || null,
        guestName: target.guestName,
        status: "OPEN",
        createdBy: user._id,
        updatedBy: user._id,
      },
    ],
    dbSession ? { session: dbSession } : undefined,
  );

  const sessionRecord = createdSessions[0];

  if (sessionRecord.tableId) {
    await syncTableOccupancyFromSessions(sessionRecord.tableId, dbSession);
  }

  return sessionRecord;
};

const createSessionInvoice = async ({
  sessionRecord,
  orders,
  user,
  dbSession = null,
}) => {
  if (sessionRecord.invoiceId) {
    const invoiceQuery = Invoice.findOne({
      invoiceId: sessionRecord.invoiceId,
      branchId: sessionRecord.branchId,
      isActive: true,
    });

    if (dbSession) {
      invoiceQuery.session(dbSession);
    }

    const existingInvoice = await invoiceQuery;

    if (existingInvoice) {
      return existingInvoice;
    }
  }

  if (!orders.length) {
    throw new Error("No orders found for this session");
  }

  const booking = sessionRecord.bookingId
    ? await Booking.findOne({
        bookingId: sessionRecord.bookingId,
        branchId: sessionRecord.branchId,
        isActive: true,
      })
        .select("_id guestName")
        .lean()
    : null;

  const billableOrders = orders.filter((order) => order.orderStatus !== "CANCELLED");

  if (!billableOrders.length) {
    throw new Error("No billable orders found for this session");
  }

  const totalAmount = roundCurrency(
    billableOrders.reduce((sum, order) => sum + Number(order.subTotal || 0), 0),
  );
  const taxAmount = roundCurrency(
    billableOrders.reduce((sum, order) => sum + Number(order.totalTax || 0), 0),
  );
  const serviceChargeAmount = roundCurrency(
    billableOrders.reduce((sum, order) => sum + Number(order.totalServiceCharge || 0), 0),
  );
  const discountAmount = roundCurrency(
    billableOrders.reduce((sum, order) => sum + Number(order.discountAmount || 0), 0),
  );
  const finalAmount = roundCurrency(
    billableOrders.reduce((sum, order) => sum + Number(order.grandTotal || 0), 0),
  );

  const payload = {
    organizationId: sessionRecord.organizationId,
    branchId: sessionRecord.branchId,
    bookingId: booking?._id || null,
    guestName: sessionRecord.guestName || booking?.guestName || "",
    sessionId: sessionRecord.sessionId,
    orderIds: billableOrders.map((order) => order.orderId),
    tableNo: sessionRecord.tableNo || null,
    roomNo: sessionRecord.roomNo || null,
    orderType: sessionRecord.type,
    type: "RESTAURANT",
    referenceType: "POS",
    referenceId: sessionRecord.sessionId,
    lineItems: mergeSessionItems(billableOrders).map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
    })),
    totalAmount,
    taxAmount,
    serviceChargeAmount,
    discountAmount,
    finalAmount,
    paidAmount: 0,
    dueAmount: finalAmount,
    status: "PENDING",
    createdBy: user._id,
    updatedBy: user._id,
  };

  const invoice = dbSession
    ? (await Invoice.create([payload], { session: dbSession }))[0]
    : await Invoice.create(payload);

  await POSOrder.updateMany(
    { sessionId: sessionRecord.sessionId, branchId: sessionRecord.branchId, isActive: true },
    { $set: { invoiceLinked: true, invoiceId: invoice.invoiceId } },
    dbSession ? { session: dbSession } : undefined,
  );

  sessionRecord.invoiceId = invoice.invoiceId;
  sessionRecord.status = "BILL_REQUESTED";
  sessionRecord.updatedBy = user._id;
  await sessionRecord.save({ session: dbSession || undefined });

  return invoice;
};

exports.openSession = async (data, user) => {
  requirePermission(user, "ACCESS_POS");

  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const sessionRecord = await ensureOpenSessionRecord({ data, user, dbSession });

    await dbSession.commitTransaction();
    dbSession.endSession();

    const orders = await getSessionOrders(sessionRecord.sessionId, sessionRecord.branchId);
    const response = buildSessionSummary(sessionRecord, orders);
    emitSessionUpdate(sessionRecord.branchId, response);
    return response;
  } catch (error) {
    await dbSession.abortTransaction();
    dbSession.endSession();
    throw error;
  }
};

exports.getSessions = async (user, filters = {}) => {
  requirePermission(user, "ACCESS_POS");

  const { organizationId, branchId } = await resolveOrganizationContext(user);
  const query = {
    organizationId,
    branchId,
    isActive: true,
  };

  if (filters.status) {
    query.status = normalizeSessionStatus(filters.status);
  }

  if (filters.type) {
    query.type = String(filters.type).toUpperCase();
  }

  const sessions = await POSSession.find(query).sort({ createdAt: -1 });
  const sessionIds = sessions.map((entry) => entry.sessionId);
  const orders = sessionIds.length
    ? await POSOrder.find({
        sessionId: { $in: sessionIds },
        branchId,
        isActive: true,
      })
        .sort({ createdAt: 1 })
        .lean()
    : [];

  const ordersBySessionId = orders.reduce((map, order) => {
    const key = String(order.sessionId);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(order);
    return map;
  }, new Map());

  return sessions.map((entry) =>
    buildSessionSummary(entry, ordersBySessionId.get(String(entry.sessionId)) || []),
  );
};

exports.getSessionById = async (sessionId, user) => {
  requirePermission(user, "ACCESS_POS");

  const { branchId } = await resolveOrganizationContext(user);
  const sessionRecord = await POSSession.findOne({
    sessionId,
    branchId,
    isActive: true,
  });

  if (!sessionRecord) {
    throw new Error("Session not found");
  }

  const [orders, invoice] = await Promise.all([
    getSessionOrders(sessionId, branchId),
    sessionRecord.invoiceId
      ? Invoice.findOne({
          invoiceId: sessionRecord.invoiceId,
          branchId,
          isActive: true,
        }).lean()
      : null,
  ]);

  return buildSessionSummary(sessionRecord, orders, invoice);
};

exports.updateSessionGuestName = async (sessionId, guestName, user) => {
  requirePermission(user, "ACCESS_POS");

  const { branchId } = await resolveOrganizationContext(user);
  const sessionRecord = await POSSession.findOne({
    sessionId,
    branchId,
    isActive: true,
  });

  if (!sessionRecord) {
    throw new Error("Session not found");
  }

  sessionRecord.guestName = String(guestName || "").trim();
  sessionRecord.updatedBy = user._id;
  await sessionRecord.save();

  await POSOrder.updateMany(
    { sessionId, branchId, isActive: true },
    { $set: { guestName: sessionRecord.guestName } },
  );

  const response = await exports.getSessionById(sessionId, user);
  emitSessionUpdate(branchId, response);
  return response;
};

exports.transferSession = async (sessionId, data, user) => {
  requirePermission(user, "ACCESS_POS");

  const { branchId } = await resolveOrganizationContext(user);
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const sessionRecord = await POSSession.findOne({
      sessionId,
      branchId,
      isActive: true,
      status: "OPEN",
    }).session(dbSession);

    if (!sessionRecord) {
      throw new Error("Open session not found");
    }

    const previousTableId = sessionRecord.tableId ? String(sessionRecord.tableId) : null;

    if (sessionRecord.type === "DINE_IN") {
      if (!data.tableId) {
        throw new Error("Target table is required");
      }

      const target = await resolvePOSSessionTarget({
        data: { type: "DINE_IN", tableId: data.tableId, tableNo: data.tableNo },
        branchId,
        dbSession,
      });

      sessionRecord.tableId = target.selectedTable?._id || null;
      sessionRecord.tableNo = target.tableNo;
    } else if (sessionRecord.type === "ROOM_SERVICE") {
      if (!data.roomId) {
        throw new Error("Target room is required");
      }

      const target = await resolvePOSSessionTarget({
        data: { type: "ROOM_SERVICE", roomId: data.roomId, bookingId: data.bookingId },
        branchId,
        dbSession,
      });

      sessionRecord.roomId = target.selectedRoom?._id || null;
      sessionRecord.roomNo = target.roomNo;
      sessionRecord.bookingId = target.activeBooking?.bookingId || null;
      sessionRecord.guestName = target.guestName || sessionRecord.guestName;
    } else {
      throw new Error("Transfer is not supported for takeaway sessions");
    }

    sessionRecord.updatedBy = user._id;
    await sessionRecord.save({ session: dbSession });

    await POSOrder.updateMany(
      { sessionId, branchId, isActive: true },
      {
        $set: {
          tableId: sessionRecord.tableId || null,
          tableNumber: sessionRecord.tableNo || null,
          roomId: sessionRecord.roomId || null,
          roomNumber: sessionRecord.roomNo || null,
          bookingId: sessionRecord.bookingId || null,
          guestName: sessionRecord.guestName || "",
        },
      },
      { session: dbSession },
    );

    if (previousTableId && previousTableId !== String(sessionRecord.tableId || "")) {
      await syncTableOccupancyFromSessions(previousTableId, dbSession);
    }

    if (sessionRecord.tableId) {
      await syncTableOccupancyFromSessions(sessionRecord.tableId, dbSession);
    }

    await dbSession.commitTransaction();
    dbSession.endSession();

    const response = await exports.getSessionById(sessionId, user);
    emitSessionUpdate(branchId, response);
    return response;
  } catch (error) {
    await dbSession.abortTransaction();
    dbSession.endSession();
    throw error;
  }
};

exports.generateBill = async (sessionId, user) => {
  requirePermission(user, "ACCESS_POS");

  const { branchId } = await resolveOrganizationContext(user);
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const sessionRecord = await POSSession.findOne({
      sessionId,
      branchId,
      isActive: true,
      status: { $in: ["OPEN", "BILL_REQUESTED"] },
    }).session(dbSession);

    if (!sessionRecord) {
      throw new Error("Open session not found");
    }

    const orders = await POSOrder.find({
      sessionId,
      branchId,
      isActive: true,
      orderStatus: { $ne: "CANCELLED" },
    })
      .sort({ createdAt: 1 })
      .session(dbSession);

    if (!orders.length) {
      throw new Error("No served orders found for this session");
    }

    const allServed = orders.every(
      (order) => String(order.orderStatus || "").toUpperCase() === "SERVED",
    );

    if (!allServed) {
      throw new Error("All session orders must be served before billing");
    }

    const invoice = await createSessionInvoice({
      sessionRecord,
      orders,
      user,
      dbSession,
    });

    await dbSession.commitTransaction();
    dbSession.endSession();

    await notificationService.createNotificationSafely({
      title: "Restaurant invoice generated",
      message: `Invoice ${invoice.invoiceId} was generated for session ${sessionId}.`,
      type: "invoice",
      organizationId: sessionRecord.organizationId,
      branchId: sessionRecord.branchId,
      module: "FINANCE",
    });

    emitSessionUpdate(branchId, await exports.getSessionById(sessionId, user));
    return invoice;
  } catch (error) {
    await dbSession.abortTransaction();
    dbSession.endSession();
    throw error;
  }
};

exports.paySessionInvoice = async (sessionId, paymentMethod, user) => {
  requirePermission(user, "ACCESS_POS");

  const { branchId } = await resolveOrganizationContext(user);
  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const sessionRecord = await POSSession.findOne({
      sessionId,
      branchId,
      isActive: true,
    }).session(dbSession);

    if (!sessionRecord) {
      throw new Error("Session not found");
    }

    const invoice = await Invoice.findOne({
      invoiceId: sessionRecord.invoiceId,
      branchId,
      isActive: true,
    }).session(dbSession);

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    const amount = Number(invoice.dueAmount ?? invoice.finalAmount ?? 0);

    invoice.paidAmount = Number(invoice.finalAmount || 0);
    invoice.dueAmount = 0;
    invoice.status = "PAID";
    invoice.updatedBy = user._id;
    invoice.paymentHistory.push({
      amount,
      method: paymentMethod,
      recordedBy: user._id,
      paidAt: new Date(),
    });
    await invoice.save({ session: dbSession });

    sessionRecord.status = "CLOSED";
    sessionRecord.updatedBy = user._id;
    await sessionRecord.save({ session: dbSession });

    await POSOrder.updateMany(
      { sessionId, branchId, isActive: true },
      { $set: { paymentStatus: "PAID", paymentMethod } },
      { session: dbSession },
    );

    if (sessionRecord.tableId) {
      await syncTableOccupancyFromSessions(sessionRecord.tableId, dbSession);
    }

    await dbSession.commitTransaction();
    dbSession.endSession();

    emitSessionUpdate(branchId, await exports.getSessionById(sessionId, user));
    return invoice;
  } catch (error) {
    await dbSession.abortTransaction();
    dbSession.endSession();
    throw error;
  }
};

exports.createOrder = async (data, user) => {
  requirePermission(user, "ACCESS_POS");

  const { items, discountAmount: incomingDiscountAmount = 0, discountPercentage: incomingDiscountPercentage = 0 } = data;

  if (!items || !items.length) {
    throw new Error("Order must contain items");
  }

  const { organizationId, branchId } = await resolveOrganizationContext(user);
  const branch = await Branch.findById(branchId).select("name").lean();

  if (!branch) {
    throw new Error("Branch not found");
  }

  const branchPrefix = String(branch.name || "BR")
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase() || "BR";

  const financialSettings = await branchSettingsService.getFinancialSettingsByBranchId(branchId);

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
      quantity: Number(item.quantity || 0),
      totalItemAmount: itemTotal,
      kitchenStatus: "PENDING",
      kitchenStation: menuItem.kitchenStation || "MAIN_KITCHEN",
    });
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
  const grandTotal = roundCurrency(taxableBase + totalTax + totalServiceCharge);

  const dbSession = await mongoose.startSession();
  dbSession.startTransaction();

  try {
    const sessionRecord = await ensureOpenSessionRecord({ data, user, dbSession });
    const lastOrder = await POSOrder.findOne({ branchId })
      .sort({ orderNumber: -1 })
      .select("orderNumber")
      .session(dbSession)
      .lean();
    const nextOrderNumber = lastOrder ? lastOrder.orderNumber + 1 : 1;

    const createdOrders = await POSOrder.create(
      [
        {
          sessionId: sessionRecord.sessionId,
          sessionRef: sessionRecord._id,
          orderNumber: nextOrderNumber,
          orderCode: `${branchPrefix}-${String(nextOrderNumber).padStart(3, "0")}`,
          organizationId,
          branchId,
          tableId: sessionRecord.tableId || null,
          tableNumber: sessionRecord.tableNo || null,
          roomId: sessionRecord.roomId || null,
          roomNumber: sessionRecord.roomNo || null,
          bookingId: sessionRecord.bookingId || null,
          guestName: sessionRecord.guestName || "",
          orderType: sessionRecord.type,
          items: orderItems,
          subTotal,
          totalTax,
          totalServiceCharge,
          discountAmount,
          discountPercentage,
          grandTotal,
          orderStatus: "PLACED",
          createdBy: user._id,
        },
      ],
      { session: dbSession },
    );

    const order = createdOrders[0];

    if (sessionRecord.tableId) {
      await syncTableOccupancyFromSessions(sessionRecord.tableId, dbSession);
    }

    await dbSession.commitTransaction();
    dbSession.endSession();

    emitOrderUpdate("new-order", branchId, order);
    emitSessionUpdate(branchId, await exports.getSessionById(sessionRecord.sessionId, user));

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
    await dbSession.abortTransaction();
    dbSession.endSession();
    throw error;
  }
};

exports.updateKitchenStatus = async (orderId, itemId, status, user) => {
  requirePermission(user, "ACCESS_POS");

  const normalizedStatus = String(status || "").toUpperCase();

  if (!["PENDING", "PREPARING", "READY", "SERVED"].includes(normalizedStatus)) {
    throw new Error("Invalid kitchen status");
  }

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

  item.kitchenStatus = normalizedStatus;
  order.orderStatus = deriveSessionOrderStatusFromItems(order.items);
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

  order.items.forEach((item) => {
    item.kitchenStatus = "SERVED";
  });
  order.orderStatus = "SERVED";
  await order.save();

  emitOrderUpdate("order-updated", order.branchId, order);
  return order;
};

exports.updateOrderStatus = async (orderId, status, user) => {
  requirePermission(user, "ACCESS_POS");

  const normalizedStatus = normalizeSessionOrderStatus(status);
  const allowedStatuses = ["PLACED", "PREPARING", "READY", "SERVED", "CANCELLED"];

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

  if (normalizedStatus === "PLACED") {
    order.items.forEach((item) => {
      item.kitchenStatus = "PENDING";
    });
  }

  if (normalizedStatus === "PREPARING") {
    order.items.forEach((item) => {
      if (item.kitchenStatus === "PENDING") {
        item.kitchenStatus = "PREPARING";
      }
    });
  }

  if (normalizedStatus === "READY") {
    order.items.forEach((item) => {
      if (item.kitchenStatus === "PENDING" || item.kitchenStatus === "PREPARING") {
        item.kitchenStatus = "READY";
      }
    });
  }

  if (normalizedStatus === "SERVED") {
    order.items.forEach((item) => {
      item.kitchenStatus = "SERVED";
    });
  }

  await order.save();
  emitOrderUpdate("order-updated", order.branchId, order);
  return order;
};

exports.payOrder = async (orderId, paymentMethod, user) => {
  requirePermission(user, "ACCESS_POS");

  const order = await POSOrder.findOne({ orderId });

  if (!order) {
    throw new Error("Order not found");
  }

  order.paymentStatus = "PAID";
  order.paymentMethod = paymentMethod;
  await order.save();

  emitOrderUpdate("order-updated", order.branchId, order);
  return order;
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

  const occupiedSessions = await POSSession.find({
    branchId: targetBranchId,
    tableId: { $in: tables.map((table) => table._id) },
    status: { $in: SESSION_ACTIVE_STATUSES },
    isActive: true,
  })
    .select("tableId")
    .lean();

  const occupiedTableIds = new Set(occupiedSessions.map((entry) => String(entry.tableId)));

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
        ? { $in: SESSION_ORDER_ACTIVE_STATUSES }
        : normalizeSessionOrderStatus(filters.status);
  }

  if (filters.type) {
    query.orderType = String(filters.type).toUpperCase();
  }

  if (filters.sessionId) {
    query.sessionId = filters.sessionId;
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
    orderStatus: { $in: SESSION_KITCHEN_ORDER_STATUSES },
    isActive: true,
  })
    .sort({ createdAt: -1 })
    .lean();

  const kitchenOrders = orders
    .map((order) => ({
      ...order,
      items: (order.items || []).filter((item) =>
        ["PENDING", "PREPARING", "READY"].includes(
          String(item.kitchenStatus || "").toUpperCase(),
        ),
      ),
    }))
    .filter((order) => order.items.length > 0);

  if (!kitchenOrders.length) {
    return [];
  }

  const sessionIds = [...new Set(kitchenOrders.map((order) => order.sessionId).filter(Boolean))];
  const sessions = await POSSession.find({
    sessionId: { $in: sessionIds },
    branchId,
    isActive: true,
  })
    .select("sessionId type tableNo roomNo")
    .lean();

  const sessionMap = new Map(
    sessions.map((sessionRecord) => [String(sessionRecord.sessionId), sessionRecord]),
  );

  const groups = new Map();

  for (const order of kitchenOrders) {
    const sessionRecord = sessionMap.get(String(order.sessionId));

    if (!sessionRecord) {
      continue;
    }

    const sessionType = String(sessionRecord.type || "").toUpperCase();
    const tableNo = sessionRecord.tableNo ? String(sessionRecord.tableNo).trim() : "";
    const roomNo = sessionRecord.roomNo ? String(sessionRecord.roomNo).trim() : "";

    let groupType = "";
    let groupValue = "";

    if (sessionType === "DINE_IN" && tableNo) {
      groupType = "TABLE";
      groupValue = tableNo;
    } else if (sessionType === "ROOM_SERVICE" && roomNo) {
      groupType = "ROOM";
      groupValue = roomNo;
    } else if (sessionType === "TAKEAWAY") {
      groupType = "TAKEAWAY";
      groupValue = String(order.guestName || order.sessionId || "Takeaway").trim();
    } else {
      continue;
    }

    const groupKey = `${groupType}:${groupValue}`;
    const groupLabel =
      groupType === "TABLE"
        ? `Table ${groupValue}`
        : groupType === "ROOM"
          ? `Room ${groupValue}`
          : groupValue || "Takeaway";
    const orderWithSession = {
      ...order,
      status: order.orderStatus,
      session: {
        type: sessionType,
        tableNo: tableNo || null,
        roomNo: roomNo || null,
      },
    };

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        groupType,
        groupLabel,
        sessionId: order.sessionId,
        branchId: order.branchId,
        createdAt: order.createdAt,
        session: {
          type: sessionType,
          tableNo: tableNo || null,
          roomNo: roomNo || null,
        },
        orders: [orderWithSession],
      });
      continue;
    }

    const existingGroup = groups.get(groupKey);
    existingGroup.orders.push(orderWithSession);

    if (new Date(order.createdAt).getTime() > new Date(existingGroup.createdAt).getTime()) {
      existingGroup.createdAt = order.createdAt;
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      orders: group.orders.sort(
        (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      ),
    }))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
};
