const express = require("express");
const router = express.Router();

const roleController = require("./role.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

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
  requirePermission("ACCESS_USERS"),
  roleController.createRole,
);

router.put(
  "/:roleId/permissions",
  requireAuth,
  requirePermission("ACCESS_USERS"),
  roleController.updateRolePermissions,
);

router.delete(
  "/:roleId",
  requireAuth,
  requirePermission("ACCESS_USERS"),
  roleController.deleteRole,
);

module.exports = router;
