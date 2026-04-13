const express = require("express");
const router = express.Router();

const invoiceController = require("./invoice.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const authorize = require("../../middleware/authorize.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");
const auditMiddleware = require("../audit/audit.middleware");

/*
  Get All Invoices (Branch scoped)
  GET /api/invoices
*/
router.post(
  "/generate",
  requireAuth,
  authorize("SUPER_ADMIN", "CORPORATE_ADMIN"),
  invoiceController.generateSubscriptionInvoice,
);

router.get(
  "/:invoiceId",
  requireAuth,
  authorize("SUPER_ADMIN", "CORPORATE_ADMIN"),
  invoiceController.getSubscriptionInvoice,
);

/*
  Get All Invoices (Branch scoped)
  GET /api/invoices
*/
router.get(
  "/",
  requireAuth,
  requirePermission(["ACCESS_FINANCE", "VIEW_EXPENSE"]),
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

/*
  Update Invoice
  PATCH /api/invoices/:invoiceId
*/
router.patch(
  "/:invoiceId",
  requireAuth,
  requirePermission("ACCESS_FINANCE"),
  auditMiddleware("UPDATE_INVOICE", "INVOICE", "Updated invoice"),
  invoiceController.updateInvoice
);

/*
  Delete Invoice
  DELETE /api/invoices/:invoiceId
*/
router.delete(
  "/:invoiceId",
  requireAuth,
  requirePermission("ACCESS_FINANCE"),
  auditMiddleware("DELETE_INVOICE", "INVOICE", "Deleted invoice"),
  invoiceController.deleteInvoice
);

// Download Invoice PDF
router.get(
  "/:invoiceId/pdf",
  requireAuth,
  invoiceController.getInvoicePDF
);

module.exports = router;
