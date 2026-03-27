const Invoice = require("./invoice.model");
const mongoose = require("mongoose");
const { generateInvoicePDF } = require("./invoice.pdf");
const Organization = require("../organization/organization.model");
const Branch = require("../branch/branch.model");
const Booking = require("../booking/booking.model");
const POSOrder = require("../pos/posOrder.model");
const branchSettingsService = require("../branchSettings/branchSettings.service");

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

  const invoices = await Invoice.find(query).sort({ createdAt: -1 });

  return invoices;
};

/*
  Record Payment
*/
exports.recordPayment = async (invoiceId, data, user) => {
  requirePermission(user, "RECORD_PAYMENT");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
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
        const posOrder =
          invoice.referenceType === "POS"
            ? await POSOrder.findOne({ orderId: invoice.referenceId }).populate(
                "createdBy",
                "name email phone",
              )
            : null;

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

  const result = await Invoice.deleteOne({
    invoiceId,
    branchId: user.branchId,
  });

  if (result.deletedCount === 0) {
    throw new Error('Invoice not found');
  }

  return { message: 'Invoice deleted successfully' };
};
