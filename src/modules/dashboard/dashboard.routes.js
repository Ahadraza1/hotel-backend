const express = require("express");
const router = express.Router();
const { getDashboardOverview } = require("./dashboard.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");

router.get("/overview", requireAuth, getDashboardOverview);

module.exports = router;
