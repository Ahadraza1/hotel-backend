const express = require("express");
const router = express.Router();

const invoiceController = require("./invoice.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");
const auditMiddleware = require("../audit/audit.middleware");

/*
  Get All Invoices (Branch scoped)
  GET /api/invoices
*/
router.get(
  "/",
  requireAuth,
  requirePermission("ACCESS_FINANCE"),
  invoiceController.getInvoices
);

/*
  Record Payment for Invoice
  PATCH /api/invoices/:invoiceId/payment
*/
router.patch(
  "/:invoiceId/payment",
  requireAuth,
  requirePermission("RECORD_PAYMENT"),
  auditMiddleware("INVOICE_PAYMENT_RECORDED", "INVOICE", "Recorded invoice payment"),
  invoiceController.recordPayment
);

/*
  Deactivate Invoice
  PATCH /api/invoices/:invoiceId/deactivate
*/
router.patch(
  "/:invoiceId/deactivate",
  requireAuth,
  requirePermission("ACCESS_FINANCE"),
  auditMiddleware("DEACTIVATE_INVOICE", "INVOICE", "Deactivated invoice"),
  invoiceController.deactivateInvoice
);


// ✅ Download Invoice PDF

router.get(
  "/:invoiceId/pdf",
  requireAuth,
  requirePermission("ACCESS_FINANCE"),
  invoiceController.getInvoicePDF
);

module.exports = router;
