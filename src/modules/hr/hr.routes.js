const express = require("express");
const router = express.Router();

const hrController = require("./hr.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");
const auditMiddleware = require("../audit/audit.middleware");

/*
  ===========================
  STAFF ROUTES
  ===========================
*/

/*
  Create Staff
  POST /hr/staff
*/
router.post(
  "/staff",
  requireAuth,
  requirePermission("ACCESS_HR"),
  auditMiddleware("CREATE_STAFF", "HR", "Created staff member"),
  hrController.createStaff
);

/*
  Get Staff List
  GET /hr/staff
*/
router.get(
  "/staff",
  requireAuth,
  requirePermission(["ACCESS_HR", "VIEW_EMPLOYEE"]),
  hrController.getStaff
);

router.get(
  "/roles",
  requireAuth,
  requirePermission(["ACCESS_HR", "VIEW_EMPLOYEE"]),
  hrController.getAssignableRoles
);

router.patch(
  "/staff/:staffId",
  requireAuth,
  requirePermission("ACCESS_HR"),
  auditMiddleware("UPDATE_STAFF", "HR", "Updated staff member"),
  hrController.updateStaff
);

router.delete(
  "/staff/:staffId",
  requireAuth,
  requirePermission("ACCESS_HR"),
  auditMiddleware("DELETE_STAFF", "HR", "Deleted staff member"),
  hrController.deleteStaff
);


/*
  ===========================
  ATTENDANCE ROUTES
  ===========================
*/

/*
  Staff Check-In
  POST /hr/attendance/:staffId/check-in
*/
router.post(
  "/attendance/:staffId/check-in",
  requireAuth,
  requirePermission("ACCESS_HR"),
  auditMiddleware("CHECK_IN_STAFF", "HR", "Checked in staff"),
  hrController.checkIn
);

/*
  Staff Check-Out
  POST /hr/attendance/:staffId/check-out
*/
router.post(
  "/attendance/:staffId/check-out",
  requireAuth,
  requirePermission("ACCESS_HR"),
  auditMiddleware("CHECK_OUT_STAFF", "HR", "Checked out staff"),
  hrController.checkOut
);


/*
  ===========================
  PAYROLL ROUTES
  ===========================
*/
/*
  Get Payroll List
  GET /hr/payroll
*/
router.get(
  "/payroll",
  requireAuth,
  requirePermission(["ACCESS_HR", "VIEW_EMPLOYEE"]),
  hrController.getPayroll
);

/*
  Generate Payroll
  POST /hr/payroll/:staffId/generate
*/
router.post(
  "/payroll/:staffId/generate",
  requireAuth,
  requirePermission("ACCESS_HR"),
  auditMiddleware("GENERATE_PAYROLL", "HR", "Generated payroll"),
  hrController.generatePayroll
);

/*
  Mark Payroll Paid
  PATCH /hr/payroll/:payrollId/pay
*/
router.patch(
  "/payroll/:payrollId/pay",
  requireAuth,
  requirePermission("ACCESS_HR"),
  auditMiddleware("MARK_PAYROLL_PAID", "HR", "Marked payroll as paid"),
  hrController.markPayrollPaid
);

router.patch(
  "/payroll/:payrollId",
  requireAuth,
  requirePermission("ACCESS_HR"),
  auditMiddleware("UPDATE_PAYROLL", "HR", "Updated payroll"),
  hrController.updatePayroll
);

router.delete(
  "/payroll/:payrollId",
  requireAuth,
  requirePermission("ACCESS_HR"),
  auditMiddleware("DELETE_PAYROLL", "HR", "Deleted payroll"),
  hrController.deletePayroll
);


module.exports = router;
