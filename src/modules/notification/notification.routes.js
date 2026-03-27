const express = require("express");

const requireAuth = require("../../middleware/requireAuth.middleware");
const notificationController = require("./notification.controller");

const router = express.Router();

router.get("/", requireAuth, notificationController.getNotifications);

module.exports = router;
