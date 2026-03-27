const mongoose = require("mongoose");
require("dotenv").config({ path: "../../.env" });

const Role = require("../modules/rbac/role.model");
require("../modules/rbac/permission.model");

const roles = [
  "SUPER_ADMIN",
  "CORPORATE_ADMIN",
  "BRANCH_MANAGER",
  "FRONT_DESK",
  "HOUSEKEEPING_LEAD",
  "FINANCE_MANAGER",
  "HR_MANAGER",
];

const MONGO_URI =
  "mongodb+srv://ahadr912_db_user:zuen8agbXA9bs9Am@cluster0.4nu0yl6.mongodb.net/?appName=Cluster0";

const seedRoles = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB Connected");

    for (const roleName of roles) {
      const exists = await Role.findOne({ name: roleName });

      if (!exists) {
        await Role.create({ name: roleName });
        console.log(`Created role: ${roleName}`);
      } else {
        console.log(`Role already exists: ${roleName}`);
      }
    }

    console.log("Role seeding completed");
    process.exit();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

seedRoles();