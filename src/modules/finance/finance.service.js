const Invoice = require('../invoice/invoice.model');
const Payment = require("./payment.model");
const Expense = require("./expense.model");
const Booking = require("../booking/booking.model");
const branchSettingsService = require("../branchSettings/branchSettings.service");
const mongoose = require("mongoose");
/*
  Generate Invoice from Booking
*/
exports.generateInvoice = async (bookingId, user) => {
  const booking = await Booking.findOne({ bookingId });

  if (!booking) {
    throw new Error("Booking not found");
  }

  // Role isolation
  if (
    user.role !== "SUPER_ADMIN" &&
    booking.organizationId !== user.organizationId &&
    booking.branchId !== user.branchId
  ) {
    throw new Error("Access denied");
  }

  const financialSettings =
    await branchSettingsService.getFinancialSettingsByBranchId(
      booking.branchId,
    );
  const taxAmount =
    (booking.totalAmount * financialSettings.taxPercentage) / 100;
  const serviceChargeAmount =
    (booking.totalAmount * financialSettings.serviceChargePercentage) / 100;
  const discountAmount = 0;
  const finalAmount =
    booking.totalAmount + taxAmount + serviceChargeAmount - discountAmount;

  const invoice = await Invoice.create({
    organizationId: booking.organizationId,
    branchId: booking.branchId,
    bookingId: booking._id,
    type: "ROOM",
    referenceType: "BOOKING",
    referenceId: booking.bookingId,
    totalAmount: booking.totalAmount,
    taxAmount,
    serviceChargeAmount,
    discountAmount,
    finalAmount,
    createdBy: user.userId,
  });

  return invoice;
};

/*
  Record Payment
*/
exports.recordPayment = async (data, user) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { invoiceId, amount, paymentMethod } = data;

    const invoice = await Invoice.findOne({ invoiceId });

    if (!invoice) {
      throw new Error("Invoice not found");
    }

    const paymentArr = await Payment.create(
      [
        {
          invoiceId,
          organizationId: invoice.organizationId,
          branchId: invoice.branchId,
          amount,
          paymentMethod,
          createdBy: user.userId,
        },
      ],
      { session },
    );

    const payment = paymentArr[0];

    // Calculate total paid
    const payments = await Payment.find({ invoiceId });

    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

    if (totalPaid >= invoice.finalAmount) {
      invoice.status = "PAID";
    } else if (totalPaid > 0) {
      invoice.status = "PARTIALLY_PAID";
    }

    await invoice.save({ session });

    await session.commitTransaction();
    session.endSession();

    return payment;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    throw error;
  }
};

/*
  Add Expense
*/
exports.addExpense = async (data, user) => {
  const { title, amount, category } = data;

  if (!title || !amount || !category) {
    throw new Error("Required fields missing");
  }

  const expense = await Expense.create({
    organizationId: user.organizationId,
    branchId: user.branchId,
    title,
    amount,
    category,
    createdBy: user.userId,
  });

  return expense;
};

/*
  Revenue Summary
*/
exports.getRevenueSummary = async (user) => {
  let filter = {};

  if (user.role === "SUPER_ADMIN") {
    filter = {};
  } else if (user.role === "CORPORATE_ADMIN") {
    filter.organizationId = user.organizationId;
  } else {
    filter.branchId = user.branchId;
  }

  const invoices = await Invoice.find(filter);
  const expenses = await Expense.find(filter);

  const totalRevenue = invoices.reduce((sum, inv) => sum + inv.finalAmount, 0);
  const totalExpense = expenses.reduce((sum, exp) => sum + exp.amount, 0);

  return {
    totalRevenue,
    totalExpense,
    netProfit: totalRevenue - totalExpense,
  };
};
