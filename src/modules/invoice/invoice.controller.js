const invoiceService = require("./invoice.service");
const asyncHandler = require("../../utils/asyncHandler");
const Invoice = require("./invoice.model");
const mongoose = require("mongoose");
const AppError = require("../../utils/AppError");

const fs = require("fs");
const path = require("path");

const { generateInvoicePDF } = require("./invoice.pdf");
const Organization = require("../organization/organization.model");
const Branch = require("../branch/branch.model");
const POSOrder = require("../pos/posOrder.model");
const POSSession = require("../pos/posSession.model");
const branchSettingsService = require("../branchSettings/branchSettings.service");

/*
  Get Invoices
*/
exports.getInvoices = asyncHandler(async (req, res) => {
  const { type } = req.query;

  if (type && !["ROOM", "RESTAURANT"].includes(type)) {
    throw new AppError("Invalid invoice type", 400);
  }

  const invoices = await invoiceService.getInvoices(req.user, { type });

  return res.status(200).json({
    success: true,
    count: invoices.length,
    data: invoices,
  });
});

/*
  Record Payment
*/
exports.recordPayment = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;
  const { amount, method } = req.body;

  if (!invoiceId) {
    throw new AppError("Invoice ID is required", 400);
  }

  if (!amount || amount <= 0) {
    throw new AppError("Valid payment amount is required", 400);
  }

  if (!method) {
    throw new AppError("Payment method is required", 400);
  }

  const updatedInvoice = await invoiceService.recordPayment(
    invoiceId,
    { amount, method },
    req.user,
  );

  return res.status(200).json({
    success: true,
    message: "Payment recorded successfully",
    data: updatedInvoice,
  });
});

/*
  Deactivate Invoice
*/
exports.deactivateInvoice = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;

  if (!invoiceId) {
    throw new AppError("Invoice ID is required", 400);
  }

  const invoice = await invoiceService.deactivateInvoice(invoiceId, req.user);

  return res.status(200).json({
    success: true,
    message: "Invoice deactivated successfully",
    data: invoice,
  });
});

/*
  Get / Stream Invoice PDF
*/
exports.getInvoicePDF = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;

  const invoice = await Invoice.findOne({
    invoiceId,
    branchId: req.user.branchId,
  }).populate({
    path: "bookingId",
    populate: {
      path: "roomId",
    },
  });
  if (!invoice) {
    throw new AppError("Invoice not found", 404);
  }

  let posOrder = null;
  let posOrders = [];
  let posSession = null;

  if (invoice.referenceType === "POS") {
    if (invoice.sessionId) {
      posSession = await POSSession.findOne({
        sessionId: invoice.sessionId,
        branchId: req.user.branchId,
      }).lean();

      const orderQuery = {
        sessionId: invoice.sessionId,
        branchId: req.user.branchId,
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

    if (posOrder && posSession) {
      posOrder.tableNumber = invoice.tableNo || posSession.tableNo || posOrder.tableNumber;
      posOrder.roomNumber = invoice.roomNo || posSession.roomNo || posOrder.roomNumber;
    }
  }

  const financialSettings =
    await branchSettingsService.getFinancialSettingsByBranchId(
      invoice.branchId,
    );

  const shouldRegeneratePdf =
    !invoice.pdfUrl || (invoice.referenceType === "POS" && Boolean(invoice.sessionId));

  /*
    GENERATE PDF IF MISSING
  */
  if (shouldRegeneratePdf) {
    const organization = await Organization.findOne({
      organizationId: invoice.organizationId,
    });
    const branch = await Branch.findById(invoice.branchId);

    if (!organization || !branch) {
      throw new AppError("Organization or Branch not found", 500);
    }

    const pdfPath = await generateInvoicePDF(
      invoice,
      organization,
      branch,
      {
        booking: invoice.bookingId,
        financialSettings,
        posOrder,
        posOrders,
      },
    );

    invoice.pdfUrl = pdfPath;

    await invoice.save();
  }

  /*
    SEND PDF
  */

  const filePath = invoice.pdfUrl;

  if (!fs.existsSync(filePath)) {
    // regenerate pdf
    const organization = await Organization.findOne({
      organizationId: invoice.organizationId,
    });

    const branch = await Branch.findById(invoice.branchId);

    const pdfPath = await generateInvoicePDF(
      invoice,
      organization,
      branch,
      {
        booking: invoice.bookingId,
        financialSettings,
        posOrder,
        posOrders,
      },
    );

    invoice.pdfUrl = pdfPath;
    await invoice.save();
  }

  res.setHeader("Content-Type", "application/pdf");

  if (req.query.download) {
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=invoice-${invoice.invoiceId}.pdf`,
    );
  }

  fs.createReadStream(filePath).pipe(res);
});

/*
  Update Invoice
*/
exports.updateInvoice = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;

  if (!invoiceId) {
    throw new AppError('Invoice ID is required', 400);
  }

  const updatedInvoice = await invoiceService.updateInvoice(
    invoiceId,
    req.body,
    req.user,
  );

  return res.status(200).json({
    success: true,
    message: 'Invoice updated successfully',
    data: updatedInvoice,
  });
});

/*
  Delete Invoice
*/
exports.deleteInvoice = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;

  if (!invoiceId) {
    throw new AppError('Invoice ID is required', 400);
  }

  const result = await invoiceService.deleteInvoice(invoiceId, req.user);

  return res.status(200).json({
    success: true,
    message: result.message,
  });
});
