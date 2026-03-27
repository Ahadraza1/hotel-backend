const mongoose = require("mongoose");
require("dotenv").config();
const InventoryItem = require("../modules/inventory/inventory.model");
const Branch = require("../modules/branch/branch.model");
const { v4: uuidv4 } = require("uuid");

const MONGO_URI =
  "mongodb+srv://ahadr912_db_user:zuen8agbXA9bs9Am@cluster0.4nu0yl6.mongodb.net/?appName=Cluster0";

async function seedInventory() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB Connected");

    const userId = "69a6b9f3fc5cc546f6c39226"; // valid user

    const branches = await Branch.find();

    if (!branches.length) {
      console.log("❌ No branches found");
      process.exit();
    }

    for (const branch of branches) {
      console.log(`🌿 Seeding for branch: ${branch.name}`);

      const items = [
        {
          itemId: uuidv4(),
          organizationId: branch.organizationId,
          branchId: branch._id.toString(),
          name: "Bedsheet",
          category: "Room",
          unit: "pcs",
          quantityAvailable: Math.floor(Math.random() * 200),
          costPerUnit: 22,
          minimumStockLevel: 20,
          createdBy: userId,
        },
        {
          itemId: uuidv4(),
          organizationId: branch.organizationId,
          branchId: branch._id.toString(),
          name: "Bath Towel",
          category: "Room",
          unit: "pcs",
          quantityAvailable: Math.floor(Math.random() * 50),
          costPerUnit: 12,
          minimumStockLevel: 30,
          createdBy: userId,
        },
      ];

      for (const item of items) {
        await InventoryItem.updateOne(
          { branchId: item.branchId, name: item.name },
          { $setOnInsert: item },
          { upsert: true }
        );
      }
    }

    console.log("✅ Multi-Branch Inventory Seeded Successfully");
    process.exit();
  } catch (error) {
    console.error("❌ Seeding Failed:", error);
    process.exit(1);
  }
}

seedInventory();