const Invoice = require("./invoice.model");
const mongoose = require("mongoose");
const { generateInvoicePDF } = require("./invoice.pdf");
const Organization = require("../organization/organization.model");
const Branch = require("../branch/branch.model");
const Booking = require("../booking/booking.model");
const POSOrder = require("../pos/posOrder.model");
const POSSession = require("../pos/posSession.model");
const POSTable = require("../pos/posTable.model");
const branchSettingsService = require("../branchSettings/branchSettings.service");
const { ensureActiveBranch } = require("../../utils/workspaceScope");

const deriveGuestName = ({ invoice, booking, posOrder }) => {
  if (invoice.guestName) {
    return invoice.guestName;
  }

  if (invoice.referenceType === "BOOKING") {
    return booking?.guestName || "Guest";
  }

  if (invoice.orderType === "TAKEAWAY" || posOrder?.orderType === "TAKEAWAY") {
    return "Takeaway Guest";
  }

  if (invoice.orderType === "ROOM_SERVICE" || posOrder?.orderType === "ROOM_SERVICE") {
    return invoice.guestName || booking?.guestName || invoice.roomNo || "Guest";
  }

  return invoice.guestName || invoice.tableNo || posOrder?.tableNumber || "Walk-in Guest";
};

const deriveOrderType = ({ invoice, posOrder }) => {
  if (invoice.orderType) {
    return invoice.orderType;
  }

  if (invoice.referenceType === "BOOKING") {
    return "ROOM_SERVICE";
  }

  return posOrder?.orderType || null;
};

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
  Get Invoices
*/
exports.getInvoices = async (user, filters = {}) => {
  requirePermission(user, "ACCESS_FINANCE");

  if (!user.branchId) {
    throw new Error("No active branch selected");
  }

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const query = {
    branchId: user.branchId,
    isActive: true,
  };

  if (filters.type === "ROOM") {
    query.$or = [
      { type: "ROOM" },
      { type: { $exists: false }, referenceType: "BOOKING" },
    ];
  }

  if (filters.type === "RESTAURANT") {
    query.$or = [
      { type: "RESTAURANT" },
      { type: { $exists: false }, referenceType: "POS" },
    ];
  }

  const invoices = await Invoice.find(query).sort({ createdAt: -1 }).lean();

  const bookingObjectIds = invoices
    .map((invoice) => invoice.bookingId)
    .filter(Boolean);
  const posReferenceIds = invoices
    .filter((invoice) => invoice.referenceType === "POS" && invoice.referenceId)
    .map((invoice) => invoice.referenceId);
  const sessionIds = invoices.map((invoice) => invoice.sessionId).filter(Boolean);

  const [bookings, posOrders, posSessions] = await Promise.all([
    bookingObjectIds.length
      ? Booking.find({ _id: { $in: bookingObjectIds } })
          .select("_id guestName guestPhone")
          .lean()
      : [],
    posReferenceIds.length
      ? POSOrder.find({ orderId: { $in: posReferenceIds } })
          .select("orderId orderType tableNumber roomNumber bookingId")
          .lean()
      : [],
    sessionIds.length
      ? POSSession.find({ sessionId: { $in: sessionIds } })
          .select("sessionId guestName tableNo roomNo type")
          .lean()
      : [],
  ]);

  const bookingMap = new Map(bookings.map((booking) => [String(booking._id), booking]));
  const posOrderMap = new Map(posOrders.map((order) => [String(order.orderId), order]));
  const sessionMap = new Map(posSessions.map((session) => [String(session.sessionId), session]));

  return invoices.map((invoice) => {
    const booking = invoice.bookingId ? bookingMap.get(String(invoice.bookingId)) : null;
    const posOrder =
      invoice.referenceType === "POS" && invoice.referenceId
        ? posOrderMap.get(String(invoice.referenceId))
        : null;
    const posSession = invoice.sessionId
      ? sessionMap.get(String(invoice.sessionId))
      : null;

    return {
      ...invoice,
      guestName:
        invoice.guestName ||
        posSession?.guestName ||
        deriveGuestName({ invoice, booking, posOrder }),
      orderType: invoice.orderType || posSession?.type || deriveOrderType({ invoice, posOrder }),
      tableNo: invoice.tableNo || posSession?.tableNo || posOrder?.tableNumber || null,
      roomNo: invoice.roomNo || posSession?.roomNo || posOrder?.roomNumber || null,
    };
  });
};

/*
  Record Payment
*/
exports.recordPayment = async (invoiceId, data, user) => {
  requirePermission(user, "RECORD_PAYMENT");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!(await ensureActiveBranch(user.branchId))) {
      throw new Error("Branch not found");
    }

    const { amount, method } = data;

    if (!amount || amount <= 0) {
      throw new Error("Invalid payment amount");
    }

    const invoice = await Invoice.findOne({
      invoiceId,
      branchId: user.branchId,
    }).session(session);

    if (!invoice || !invoice.isActive) {
      throw new Error("Invoice not found");
    }

    if (amount > invoice.dueAmount) {
      throw new Error("Payment exceeds due amount");
    }

    /* ==========================
       UPDATE PAYMENT
    ========================== */

    invoice.paidAmount += amount;
    invoice.dueAmount -= amount;

    if (invoice.dueAmount <= 0) {
      invoice.status = "PAID";
      invoice.dueAmount = 0;
    } else {
      invoice.status = "PARTIALLY_PAID";
    }

    /* ==========================
       PAYMENT HISTORY
    ========================== */

    invoice.paymentHistory.push({
      amount,
      method,
      recordedBy: user.id || user.userId,
      paidAt: new Date(),
    });

    /* ==========================
       GENERATE PDF IF PAID
    ========================== */

    /* ==========================
   GENERATE PDF IF FULLY PAID
========================== */

    if (invoice.dueAmount === 0) {
      try {
        const organization = await Organization.findOne({
          organizationId: invoice.organizationId,
        });
        const branch = await Branch.findById(invoice.branchId);
        const booking = invoice.bookingId
          ? await Booking.findById(invoice.bookingId)
          : null;
        const financialSettings =
          await branchSettingsService.getFinancialSettingsByBranchId(
            invoice.branchId,
          );
        let posOrder = null;
        let posOrders = [];

        if (invoice.referenceType === "POS") {
          if (invoice.sessionId) {
            const orderQuery = {
              sessionId: invoice.sessionId,
              branchId: user.branchId,
              isActive: true,
            };

            if (Array.isArray(invoice.orderIds) && invoice.orderIds.length) {
              orderQuery.orderId = { $in: invoice.orderIds };
            }

            posOrders = await POSOrder.find(orderQuery)
              .sort({ createdAt: 1 })
              .populate("createdBy", "name email phone");
            posOrder = posOrders[0] || null;
          } else {
            posOrder = await POSOrder.findOne({ orderId: invoice.referenceId }).populate(
              "createdBy",
              "name email phone",
            );
            posOrders = posOrder ? [posOrder] : [];
          }
        }

        if (!organization || !branch) {
          console.error("Organization or Branch not found for invoice PDF");
        } else {
          const pdfPath = await generateInvoicePDF(
            invoice,
            organization,
            branch,
            {
              booking,
              financialSettings,
              posOrder,
              posOrders,
            },
          );

          invoice.pdfUrl = pdfPath;
        }
      } catch (err) {
        console.error("Invoice PDF generation failed:", err);
      }
    }

    /*
  Sync Booking Payment Status
*/
    if (invoice.status === "PAID") {
      await Booking.findByIdAndUpdate(
        invoice.bookingId,
        { paymentStatus: "PAID" },
        { session },
      );

      if (invoice.sessionId) {
        const posSession = await POSSession.findOne({
          sessionId: invoice.sessionId,
          branchId: user.branchId,
          isActive: true,
        }).session(session);

        if (posSession) {
          posSession.status = "CLOSED";
          posSession.invoiceId = invoice.invoiceId;
          await posSession.save({ session });

          if (posSession.tableId) {
            await POSTable.findByIdAndUpdate(
              posSession.tableId,
              { status: "AVAILABLE" },
              { session },
            );
          }

          await POSOrder.updateMany(
            {
              sessionId: posSession.sessionId,
              branchId: user.branchId,
              isActive: true,
            },
            {
              $set: {
                paymentStatus: "PAID",
                paymentMethod: method,
                invoiceLinked: true,
                invoiceId: invoice.invoiceId,
              },
            },
            { session },
          );
        }
      }
    }

    await invoice.save({ session });

    await session.commitTransaction();
    session.endSession();

    return invoice;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/*
  Soft Delete Invoice
*/
exports.deactivateInvoice = async (invoiceId, user) => {
  requirePermission(user, "ACCESS_FINANCE");

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const invoice = await Invoice.findOne({
    invoiceId,
    branchId: user.branchId,
  });

  if (!invoice) {
    throw new Error("Invoice not found");
  }

  invoice.isActive = false;
  await invoice.save();

  return invoice;
};

/*
  Update Invoice
*/
exports.updateInvoice = async (invoiceId, data, user) => {
  requirePermission(user, 'ACCESS_FINANCE');

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const invoice = await Invoice.findOne({
    invoiceId,
    branchId: user.branchId,
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  // Update allowed fields
  const allowedUpdates = [
    'status',
    'totalAmount',
    'taxAmount',
    'finalAmount',
    'paidAmount',
    'dueAmount',
    'type',
  ];

  allowedUpdates.forEach((field) => {
    if (data[field] !== undefined) {
      invoice[field] = data[field];
    }
  });

  await invoice.save();

  return invoice;
};

/*
  Hard Delete Invoice
*/
exports.deleteInvoice = async (invoiceId, user) => {
  requirePermission(user, 'ACCESS_FINANCE');

  if (!(await ensureActiveBranch(user.branchId))) {
    throw new Error("Branch not found");
  }

  const result = await Invoice.deleteOne({
    invoiceId,
    branchId: user.branchId,
  });

  if (result.deletedCount === 0) {
    throw new Error('Invoice not found');
  }

  return { message: 'Invoice deleted successfully' };
};
