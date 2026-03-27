const express = require("express");
const router = express.Router();

const permissionController = require("./permission.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  Get All Permissions
*/
router.get("/", requireAuth, permissionController.getPermissions);
router.post(
  "/",
  requireAuth,
  requirePermission("ACCESS_USERS"),
  permissionController.createPermission,
);

module.exports = router;
