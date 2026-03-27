require("dotenv").config();
const mongoose = require("mongoose");

const Branch = require("../modules/branch/branch.model");
const POSTable = require("../modules/pos/posTable.model");

async function seedTables() {
  try {

    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB Connected");

    const branches = await Branch.find();

    if (!branches.length) {
      console.log("No branches found");
      return;
    }

    const tableTemplates = [
      { name: "Table 1", seats: 2 },
      { name: "Table 2", seats: 2 },
      { name: "Table 3", seats: 4 },
      { name: "Table 4", seats: 4 },
      { name: "Table 5", seats: 6 },
      { name: "Table 6", seats: 6 },
      { name: "Table 7", seats: 8 },
      { name: "Table 8", seats: 8 },
      { name: "Table 9", seats: 4 },
      { name: "Table 10", seats: 6 },
      { name: "Table 11", seats: 10 },
      { name: "Table 12", seats: 12 },
    ];

    for (const branch of branches) {

      console.log("Seeding tables for branch:", branch.name);

      for (const table of tableTemplates) {

        await POSTable.create({
          organizationId: branch.organizationId,
          branchId: branch._id,
          name: table.name,
          seats: table.seats,
          tableType: "REGULAR",
          displayOrder: 1,
          createdBy: new mongoose.Types.ObjectId(),
        });

      }
    }

    console.log("Tables seeded successfully");

    process.exit();

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

seedTables();