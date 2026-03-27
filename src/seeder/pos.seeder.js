const mongoose = require("mongoose");
const { faker } = require("@faker-js/faker");

const POSCategory = require("../modules/pos/posCategory.model");
const POSItem = require("../modules/pos/posItem.model");
const POSOrder = require("../modules/pos/posOrder.model");
const POSTable = require("../modules/pos/posTable.model");

module.exports = async function seedPOS(branches, users) {

  console.log("🌱 Seeding POS data...");

  for (const branch of branches) {

    const organizationId = branch.organizationId;
    const branchId = branch.branchId;
    const createdBy = users[0]._id;

    /* -------------------------
       TABLES
    ------------------------- */

    const tables = [];

    for (let i = 1; i <= 10; i++) {

      tables.push({
        organizationId,
        branchId,
        name: `T-${i}`,
        seats: faker.number.int({ min: 2, max: 6 }),
        tableType: faker.helpers.arrayElement([
          "REGULAR",
          "VIP",
          "PRIVATE_DINING",
        ]),
        location: faker.helpers.arrayElement([
          "Main Hall",
          "Garden",
          "Terrace",
        ]),
        createdBy,
      });

    }

    const createdTables = await POSTable.insertMany(tables);

    /* -------------------------
       CATEGORIES
    ------------------------- */

    const categoriesData = [
      { name: "Starters", type: "FOOD" },
      { name: "Main Course", type: "FOOD" },
      { name: "Desserts", type: "FOOD" },
      { name: "Soft Drinks", type: "BEVERAGE" },
      { name: "Cocktails", type: "BAR" },
    ];

    const categories = categoriesData.map((c) => ({
      organizationId,
      branchId,
      name: c.name,
      type: c.type,
      description: faker.commerce.productDescription(),
      createdBy,
    }));

    const createdCategories = await POSCategory.insertMany(categories);

    /* -------------------------
       ITEMS
    ------------------------- */

    const items = [];

    for (const cat of createdCategories) {

      for (let i = 0; i < 5; i++) {

        items.push({
          organizationId,
          branchId,
          categoryId: cat.categoryId,
          name: faker.commerce.productName(),
          description: faker.commerce.productDescription(),
          price: faker.number.int({ min: 5, max: 50 }),
          taxPercentage: 10,
          serviceChargePercentage: 5,
          preparationTimeMinutes: faker.number.int({ min: 5, max: 20 }),
          kitchenStation: faker.helpers.arrayElement([
            "MAIN_KITCHEN",
            "BAR",
            "BAKERY",
            "ROOM_SERVICE",
          ]),
          createdBy,
        });

      }

    }

    const createdItems = await POSItem.insertMany(items);

    /* -------------------------
       ORDERS
    ------------------------- */

    const orders = [];

    for (let i = 0; i < 20; i++) {

      const table = faker.helpers.arrayElement(createdTables);

      const item = faker.helpers.arrayElement(createdItems);

      const qty = faker.number.int({ min: 1, max: 3 });

      const total = item.price * qty;

      orders.push({
        organizationId,
        branchId,
        tableNumber: table.name,
        orderNumber: 5000 + i,
        orderCode: `ORD-POS-${5000 + i}`,
        orderType: "DINE_IN",

        items: [
          {
            itemId: item.itemId,
            nameSnapshot: item.name,
            priceSnapshot: item.price,
            taxPercentageSnapshot: item.taxPercentage,
            serviceChargePercentageSnapshot: item.serviceChargePercentage,
            quantity: qty,
            totalItemAmount: total,
          },
        ],

        subTotal: total,
        totalTax: total * 0.1,
        totalServiceCharge: total * 0.05,
        grandTotal: total * 1.15,

        paymentStatus: faker.helpers.arrayElement([
          "UNPAID",
          "PAID",
        ]),

        paymentMethod: faker.helpers.arrayElement([
          "CASH",
          "CARD",
          "UPI",
        ]),

        orderStatus: faker.helpers.arrayElement([
          "OPEN",
          "IN_PROGRESS",
          "COMPLETED",
        ]),

        createdBy,
      });

    }

    await POSOrder.insertMany(orders);

  }

  console.log("✅ POS seeding completed");

};