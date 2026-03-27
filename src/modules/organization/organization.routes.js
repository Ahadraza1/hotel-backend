const express = require("express");
const router = express.Router();

const organizationController = require("./organization.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");
const requireCorporateAdmin = require("../../middleware/requireCorporateAdmin.middleware");
const auditMiddleware = require("../audit/audit.middleware");

/*
  Create Organization
  SUPER_ADMIN only
*/
router.post(
  "/",
  requireAuth,
  requireSuperAdmin,
  auditMiddleware("CREATE_ORGANIZATION", "ORGANIZATION", "Created organization"),
  organizationController.createOrganization
);

/*
  Get All Organizations
  SUPER_ADMIN only
*/
router.get(
  "/",
  requireAuth,
  requireSuperAdmin,
  organizationController.getAllOrganizations
);

/*
  Get Organization By ID
  SUPER_ADMIN only
*/
router.get(
  "/:id",
  requireAuth,
  requireSuperAdmin,
  organizationController.getOrganizationById
);

/*
  Update Organization
  SUPER_ADMIN only
*/
router.put(
  "/:id",
  requireAuth,
  requireSuperAdmin,
  auditMiddleware("UPDATE_ORGANIZATION", "ORGANIZATION", "Updated organization"),
  organizationController.updateOrganization
);

/*
  Delete Organization
  SUPER_ADMIN only
*/
router.delete(
  "/:id",
  requireAuth,
  requireSuperAdmin,
  auditMiddleware("DELETE_ORGANIZATION", "ORGANIZATION", "Deleted organization"),
  organizationController.deleteOrganization
);

/*
  Deactivate Organization
  SUPER_ADMIN only
*/
router.patch(
  "/:organizationId/deactivate",
  requireAuth,
  requireSuperAdmin,
  auditMiddleware("DEACTIVATE_ORGANIZATION", "ORGANIZATION", "Deactivated organization"),
  organizationController.deactivateOrganization
);

/*
  CORPORATE ADMIN
*/
router.get(
  "/my-organization",
  requireAuth,
  requireCorporateAdmin,
  organizationController.getMyOrganization
);

/*
  Block Organization
  SUPER_ADMIN only
*/
router.patch(
  "/:id/block",
  requireAuth,
  requireSuperAdmin,
  auditMiddleware("BLOCK_ORGANIZATION", "ORGANIZATION", "Blocked organization"),
  organizationController.blockOrganization
);

/*
  Unblock Organization
  SUPER_ADMIN only
*/
router.patch(
  "/:id/unblock",
  requireAuth,
  requireSuperAdmin,
  auditMiddleware("UNBLOCK_ORGANIZATION", "ORGANIZATION", "Unblocked organization"),
  organizationController.unblockOrganization
);

module.exports = router;
