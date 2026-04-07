const express = require("express");
const router = express.Router();

const posController = require("./pos.controller");

const requireAuth = require("../../middleware/requireAuth.middleware");
const requirePermission = require("../../middleware/requirePermission.middleware");

/*
  ===========================
  SESSION ROUTES
  ===========================
*/

router.post(
  "/sessions",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.openSession
);

router.get(
  "/sessions",
  requireAuth,
  requirePermission(["ACCESS_POS", "VIEW_POS_MENU"]),
  posController.getSessions
);

router.get(
  "/sessions/:sessionId",
  requireAuth,
  requirePermission(["ACCESS_POS", "VIEW_POS_MENU"]),
  posController.getSessionById
);

router.delete(
  "/sessions/:sessionId",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.deleteSession
);

router.patch(
  "/sessions/:sessionId/guest",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.updateSessionGuestName
);

router.post(
  "/sessions/:sessionId/generate-bill",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.generateBill
);

router.patch(
  "/sessions/:sessionId/transfer",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.transferSession
);

router.patch(
  "/sessions/:sessionId/pay",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.paySessionInvoice
);

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
  requirePermission(["ACCESS_POS", "VIEW_POS_MENU"]),
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
  requirePermission(["ACCESS_POS", "VIEW_POS_MENU"]),
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
  requirePermission(["ACCESS_POS", "VIEW_POS_MENU"]),
  posController.getTables
);

router.get(
  "/orders",
  requireAuth,
  requirePermission(["ACCESS_POS", "VIEW_POS_MENU"]),
  posController.getOrders
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

router.patch(
  "/orders/:orderId/status",
  requireAuth,
  requirePermission("ACCESS_POS"),
  posController.updateOrderStatus
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
  requirePermission(["ACCESS_POS", "VIEW_POS_MENU"]),
  posController.getKitchenOrders
);

module.exports = router;
