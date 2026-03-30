const express = require("express");
const router = express.Router();

const roleController = require("./role.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
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
  requireSuperAdmin,
  roleController.createRole,
);

router.put(
  "/:roleId/permissions",
  requireAuth,
  requireSuperAdmin,
  roleController.updateRolePermissions,
);

router.delete(
  "/:roleId",
  requireAuth,
  requireSuperAdmin,
  roleController.deleteRole,
);

module.exports = router;
