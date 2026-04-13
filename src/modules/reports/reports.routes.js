const express = require("express");

const reportsController = require("./reports.controller");
const requireAuth = require("../../middleware/requireAuth.middleware");
const requireBranchAccess = require("../../middleware/requireBranchAccess.middleware");

const router = express.Router();

router.get("/rooms", requireAuth, requireBranchAccess, reportsController.getRoomsReport);
router.get("/restaurant", requireAuth, requireBranchAccess, reportsController.getRestaurantReport);
router.get("/housekeeping", requireAuth, requireBranchAccess, reportsController.getHousekeepingReport);
router.get("/crm", requireAuth, requireBranchAccess, reportsController.getCrmReport);

module.exports = router;
