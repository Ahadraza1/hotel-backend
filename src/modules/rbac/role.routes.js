const express = require("express");
const router = express.Router();

const roleController = require("./role.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");

/*
  Get All Roles
*/
router.get(
  "/",
  requireAuth,
  roleController.getRoles,
);

router.post(
  "/",
  requireAuth,
  requirePermission("ADD_ROLE"),
  roleController.createRole,
);

router.put(
  "/:roleId/permissions",
  requireAuth,
  requirePermission("TOGGLE_PERMISSION"),
  roleController.updateRolePermissions,
);

router.delete(
  "/:roleId",
  requireAuth,
  requireSuperAdmin,
  roleController.deleteRole,
);

module.exports = router;
