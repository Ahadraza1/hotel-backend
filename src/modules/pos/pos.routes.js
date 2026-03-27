const express = require("express");
const router = express.Router();

const posController = require("./pos.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  ===========================
  CATEGORY ROUTES
  ===========================
*/

router.post(
  "/categories",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.createCategory
);

router.get(
  "/categories",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.getCategories
);

router.put(
  "/categories/:categoryId",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.updateCategory
);

router.delete(
  "/categories/:categoryId",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.deleteCategory
);

/*
  ===========================
  MENU ITEM ROUTES
  ===========================
*/

router.post(
  "/items",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.createItem
);

router.get(
  "/items",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.getItems
);

router.put(
  "/items/:itemId",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.updateItem
);

router.delete(
  "/items/:itemId",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.deleteItem
);

/*
  ===========================
  TABLE ROUTES
  ===========================
*/

router.post(
  "/tables",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.createTable
);

router.get(
  "/tables",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.getTables
);

/*
  ===========================
  POS ORDER ROUTES
  ===========================
*/

/*
  CREATE ORDER
  POST /pos/orders
*/
router.post(
  "/orders",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.createOrder
);

/*
  UPDATE KITCHEN STATUS
*/
router.patch(
  "/orders/:orderId/items/:itemId/status",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.updateKitchenStatus
);

/*
  COMPLETE ORDER
*/
router.patch(
  "/orders/:orderId/complete",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.completeOrder
);

/*
  PAY ORDER
*/
router.patch(
  "/orders/:orderId/pay",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.payOrder
);

/*
  ===========================
  KITCHEN DISPLAY
  ===========================
*/

router.get(
  "/kitchen",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.getKitchenOrders
);

module.exports = router;
