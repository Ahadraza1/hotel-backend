const express = require("express");
const router = express.Router();

const branchController = require("./branch.controller");
const branchDashboardController = require("./branch.dashboard.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");
const requireBranchAccess = require("../../middleware/requireBranchAccess.middleware");
const auditMiddleware = require("../audit/audit.middleware");

/*
  Create Branch
*/
router.post(
  "/",
  requireAuth,
  // requirePermission("CREATE_BRANCH"),
  auditMiddleware("CREATE_BRANCH", "BRANCH", "Created branch"),
  branchController.createBranch
);

/*
  Get Branches (All)
*/
router.get(
  "/",
  requireAuth,
  branchController.getBranches
);

/*
  Branch Dashboard
*/
router.get(
  "/dashboard",
  requireAuth,
  requirePermission("VIEW_BRANCH"),
  branchDashboardController.getBranchDashboard
);

/*
  Get Single Branch (WORKSPACE ACCESS)
*/
router.get(
  "/:branchId",
  requireAuth,
  requireBranchAccess,
  branchController.getBranchById
);

/*
  Update Branch
*/
router.put(
  "/:branchId",
  requireAuth,
  requirePermission("UPDATE_BRANCH"),
  auditMiddleware("UPDATE_BRANCH", "BRANCH", "Updated branch"),
  branchController.updateBranch
);

/*
  Delete Branch
*/
router.delete(
  "/:branchId",
  requireAuth,
  requirePermission("CREATE_BRANCH"),
  auditMiddleware("DELETE_BRANCH", "BRANCH", "Deleted branch"),
  branchController.deleteBranch
);

/*
  Deactivate Branch
*/
router.patch(
  "/:branchId/deactivate",
  requireAuth,
  requirePermission("CREATE_BRANCH"),
  auditMiddleware("DEACTIVATE_BRANCH", "BRANCH", "Deactivated branch"),
  branchController.deactivateBranch
);

/*
  Invite Branch Manager
*/
router.post(
  "/invite-manager",
  requireAuth,
  requirePermission("CREATE_BRANCH"),
  auditMiddleware("INVITE_BRANCH_MANAGER", "BRANCH", "Invited branch manager"),
  branchController.inviteBranchManager
);

module.exports = router;
