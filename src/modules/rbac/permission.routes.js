const express = require("express");
const router = express.Router();

const permissionController = require("./permission.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
const requireSuperAdmin = require("../../middleware/requireSuperAdmin.middleware");

/*
  Get All Permissions
*/
router.get("/", requireAuth, requireSuperAdmin, permissionController.getPermissions);
router.post(
  "/",
  requireAuth,
  requireSuperAdmin,
  permissionController.createPermission,
);
router.delete(
  "/:permissionId",
  requireAuth,
  requireSuperAdmin,
  permissionController.deletePermission,
);

module.exports = router;
