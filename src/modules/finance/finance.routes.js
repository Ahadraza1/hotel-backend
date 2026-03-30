const express = require("express");
const router = express.Router();

const financeController = require("./finance.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");
const auditMiddleware = require("../audit/audit.middleware");

/*
  Generate Invoice
*/
router.post(
  "/invoice",
  requireAuth,
  requirePermission("GENERATE_INVOICE"),
  auditMiddleware("GENERATE_INVOICE", "FINANCE", "Generated invoice"),
  financeController.generateInvoice
);

/*
  Record Payment
*/
router.post(
  "/payment",
  requireAuth,
  requirePermission("RECORD_PAYMENT"),
  auditMiddleware("RECORD_PAYMENT", "FINANCE", "Recorded payment"),
  financeController.recordPayment
);

/*
  Add Expense
*/
router.post(
  "/expense",
  requireAuth,
  requirePermission("RECORD_PAYMENT"),
  auditMiddleware("ADD_EXPENSE", "FINANCE", "Added expense"),
  financeController.addExpense
);

router.get(
  "/expenses",
  requireAuth,
  requirePermission(["ACCESS_FINANCE", "VIEW_EXPENSE", "VIEW_INVOICE"]),
  financeController.getExpenses
);

/*
  Get Revenue Summary
*/
router.get(
  "/summary",
  requireAuth,
  requirePermission("VIEW_ANALYTICS"),
  financeController.getRevenueSummary
);

module.exports = router;
