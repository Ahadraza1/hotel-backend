const express = require("express");
const router = express.Router();

const permissionController = require("./permission.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");

/*
  Get All Permissions
*/
router.get(
  "/",
  requireAuth,
  requirePermission("ACCESS_PERMISSIONS"),
  permissionController.getPermissions,
);
router.post(
  "/",
  requireAuth,
  requirePermission("ADD_PERMISSION"),
  permissionController.createPermission,
);
router.delete(
  "/:permissionId",
  requireAuth,
  requireSuperAdmin,
  permissionController.deletePermission,
);

module.exports = router;
