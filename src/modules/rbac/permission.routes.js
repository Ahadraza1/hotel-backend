const express = require("express");
const router = express.Router();

const permissionController = require("./permission.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");

/*
  Get All Permissions
*/
router.get("/", requireAuth, permissionController.getPermissions);

module.exports = router;
