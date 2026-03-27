const express = require("express");
const router = express.Router();

const inventoryController = require("./inventory.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  ===========================
  INVENTORY ROUTES
  ===========================
*/

/*
  Create Inventory Item
  POST /inventory
*/
router.post(
  "/",
  requireAuth,
  requirePermission("ACCESS_INVENTORY"),
  inventoryController.createItem
);

/*
  Add Stock (IN)
  POST /inventory/stock/in
*/
router.post(
  "/stock/in",
  requireAuth,
  requirePermission("ACCESS_INVENTORY"),
  inventoryController.addStock
);

/*
  Remove Stock (OUT)
  POST /inventory/stock/out
*/
router.post(
  "/stock/out",
  requireAuth,
  requirePermission("ACCESS_INVENTORY"),
  inventoryController.removeStock
);

/*
  Get Inventory List
  GET /inventory
*/
router.get(
  "/",
  requireAuth,
  requirePermission("ACCESS_INVENTORY"),
  inventoryController.getInventory
);

/*
  Get Inventory Summary
  GET /inventory/summary
*/
router.get(
  "/summary",
  requireAuth,
  requirePermission("ACCESS_INVENTORY"),
  inventoryController.getInventorySummary
);

module.exports = router;