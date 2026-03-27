
const Branch = require("../branch/branch.model");
const posService = require("./pos.service");
const POSCategory = require("./posCategory.model");
const POSItem = require("./posItem.model");
const POSTable = require("./posTable.model");
const posSeeder = require("../../seeder/pos.seeder");
const { getIO } = require("../../config/socket");

/*
  CREATE ORDER
*/
exports.createOrder = async (req, res) => {
  try {

    const order = await posService.createOrder(
      req.body,
      req.user
    );

    /* 🔥 REALTIME EMIT TO KITCHEN */
    try {

      const io = getIO();

      io.to(`branch_${order.branchId}`).emit(
        "new-order",
        order
      );

    } catch (socketError) {

      console.log(
        "Socket emit skipped:",
        socketError.message
      );

    }

    res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: order,
    });

  } catch (error) {

    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });

  }
};


/*
  GET KITCHEN ORDERS
*/
exports.getKitchenOrders = async (req, res) => {

  try {

    const orders = await posService.getKitchenOrders(
      req.user
    );

    res.status(200).json({
      success: true,
      data: orders,
    });

  } catch (error) {

    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });

  }

};


/*
  UPDATE KITCHEN STATUS
*/
exports.updateKitchenStatus = async (req, res) => {

  try {

    const { orderId, itemId } = req.params;
    const { status } = req.body;

    const order =
      await posService.updateKitchenStatus(
        orderId,
        itemId,
        status,
        req.user
      );

    /* 🔥 REALTIME UPDATE */
    const io = getIO();

    io.to(`branch_${order.branchId}`).emit(
      "order-updated",
      order
    );

    res.status(200).json({
      success: true,
      message: "Kitchen status updated",
      data: order,
    });

  } catch (error) {

    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });

  }

};


/*
  COMPLETE ORDER
*/
exports.completeOrder = async (req, res) => {

  try {

    const { orderId } = req.params;

    const order =
      await posService.completeOrder(
        orderId,
        req.user
      );

    res.status(200).json({
      success: true,
      message: "Order completed",
      data: order,
    });

  } catch (error) {

    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });

  }

};


/*
  PAY ORDER
*/
exports.payOrder = async (req, res) => {

  try {

    const { orderId } = req.params;
    const { paymentMethod } = req.body;

    if (!paymentMethod) {

      return res.status(400).json({
        success: false,
        message: "Payment method required",
      });

    }

    const order = await posService.payOrder(
      orderId,
      paymentMethod,
      req.user
    );

    res.status(200).json({
      success: true,
      message: "Payment successful",
      data: order,
    });

  } catch (error) {

    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });

  }

};


/*
  CREATE CATEGORY
*/
/*
  CREATE CATEGORY
*/
exports.createCategory = async (req, res) => {
  try {

    const category = await posService.createCategory(
      req.body,
      req.user
    );

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });

  } catch (error) {

    console.error("CATEGORY ERROR:", error);

    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};
/*
  GET CATEGORIES
*/
exports.getCategories = async (req, res) => {
  try {
     
    const categories = await posService.getCategories(req.user);

    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateCategory = async (req, res) => {
  try {
    const category = await posService.updateCategory(
      req.params.categoryId,
      req.body,
      req.user,
    );

    res.status(200).json({
      success: true,
      message: "Category updated successfully",
      data: category,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const category = await posService.deleteCategory(
      req.params.categoryId,
      req.user,
    );

    res.status(200).json({
      success: true,
      message: "Category deleted successfully",
      data: category,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};


/*
  CREATE MENU ITEM
*/
exports.createItem = async (req, res) => {
  try {
    const item = await posService.createItem(
      req.body,
      req.user
    );

    res.status(201).json({
      success: true,
      message: "Menu item created",
      data: item,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};


/*
  GET MENU ITEMS
*/
exports.getItems = async (req, res) => {
  try {
    const items = await posService.getItems(req.user);

    res.status(200).json({
      success: true,
      data: items,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const item = await posService.updateItem(
      req.params.itemId,
      req.body,
      req.user,
    );

    res.status(200).json({
      success: true,
      message: "Menu item updated successfully",
      data: item,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const item = await posService.deleteItem(
      req.params.itemId,
      req.user,
    );

    res.status(200).json({
      success: true,
      message: "Menu item deleted successfully",
      data: item,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};


/*
  CREATE TABLE
*/
exports.createTable = async (req, res) => {
  try {
    const table = await posService.createTable(
      req.body,
      req.user
    );

    res.status(201).json({
      success: true,
      message: "Table created",
      data: table,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};


/*
  GET TABLES
*/
exports.getTables = async (req, res) => {
  try {
    const tables = await posService.getTables(req.user);

    res.status(200).json({
      success: true,
      data: tables,
    });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

/*
  GET KITCHEN ORDERS
*/
exports.getKitchenOrders = async (req, res) => {
  try {

    const orders = await posService.getKitchenOrders(req.user);

    res.status(200).json({
      success: true,
      data: orders,
    });

  } catch (error) {

    res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });

  }
};
