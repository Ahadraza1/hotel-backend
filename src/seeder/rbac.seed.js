require("dotenv").config({ path: "../../.env" });
const connectDB = require("../config/db");

const Permission = require("../modules/rbac/permission.model");
const Role = require("../modules/rbac/role.model");

const seedRBAC = async () => {
  try {
    await connectDB();

    console.log("Seeding Enterprise RBAC...");

    await Permission.deleteMany({});
    await Role.deleteMany({});

    // ======================
    // CREATE PERMISSIONS
    // ======================

    const permissions = await Permission.insertMany([
      // ===== GLOBAL ACCESS =====
      { name: "ACCESS_ORGANIZATION", module: "ORGANIZATION" },
      { name: "VIEW_ORGANIZATION", module: "ORGANIZATION" },
      { name: "CREATE_ORGANIZATION", module: "ORGANIZATION" },
      { name: "UPDATE_ORGANIZATION", module: "ORGANIZATION" },
      { name: "DELETE_ORGANIZATION", module: "ORGANIZATION" },
      { name: "BLOCK_ORGANIZATION", module: "ORGANIZATION" },

      { name: "ACCESS_BRANCH", module: "BRANCH" },
      { name: "VIEW_BRANCH", module: "BRANCH" },
      { name: "CREATE_BRANCH", module: "BRANCH" },
      { name: "UPDATE_BRANCH", module: "BRANCH" },
      { name: "DELETE_BRANCH", module: "BRANCH" },

      { name: "ACCESS_USERS", module: "USER" },
      { name: "CREATE_USER", module: "USER" },
      { name: "UPDATE_USER", module: "USER" },
      { name: "DELETE_USER", module: "USER" },

      { name: "ACCESS_SETTINGS", module: "SYSTEM" },
      { name: "ACCESS_ANALYTICS", module: "ANALYTICS" },
      { name: "ACCESS_AUDIT", module: "AUDIT" },

      // ===== WORKSPACE MODULE ACCESS =====

      // ROOMS
      { name: "ACCESS_ROOMS", module: "ROOM" },
      { name: "CREATE_ROOM", module: "ROOM" },
      { name: "VIEW_ROOM", module: "ROOM" },
      { name: "UPDATE_ROOM", module: "ROOM" },
      { name: "DELETE_ROOM", module: "ROOM" },

      // BOOKINGS
      { name: "ACCESS_BOOKINGS", module: "BOOKING" },
      { name: "CREATE_BOOKING", module: "BOOKING" },
      { name: "VIEW_BOOKING", module: "BOOKING" },
      { name: "UPDATE_BOOKING", module: "BOOKING" },
      { name: "DELETE_BOOKING", module: "BOOKING" },

      // CRM
      { name: "ACCESS_CRM", module: "CRM" },
      { name: "CREATE_GUEST", module: "CRM" },
      { name: "VIEW_GUEST", module: "CRM" },
      { name: "UPDATE_GUEST", module: "CRM" },
      { name: "DELETE_GUEST", module: "CRM" },

      // HOUSEKEEPING
      { name: "ACCESS_HOUSEKEEPING", module: "HOUSEKEEPING" },
      { name: "CREATE_TASK", module: "HOUSEKEEPING" },
      { name: "UPDATE_TASK", module: "HOUSEKEEPING" },
      { name: "DELETE_TASK", module: "HOUSEKEEPING" },

      // POS
      { name: "ACCESS_POS", module: "POS" },
      { name: "CREATE_POS_ORDER", module: "POS" },
      { name: "UPDATE_POS_ORDER", module: "POS" },
      { name: "DELETE_POS_ORDER", module: "POS" },
      { name: "MANAGE_POS_MENU", module: "POS" },

      // INVENTORY
      { name: "ACCESS_INVENTORY", module: "INVENTORY" },
      { name: "CREATE_INVENTORY_ITEM", module: "INVENTORY" },
      { name: "UPDATE_INVENTORY_ITEM", module: "INVENTORY" },
      { name: "DELETE_INVENTORY_ITEM", module: "INVENTORY" },

      // HR
      { name: "ACCESS_HR", module: "HR" },
      { name: "CREATE_EMPLOYEE", module: "HR" },
      { name: "UPDATE_EMPLOYEE", module: "HR" },
      { name: "DELETE_EMPLOYEE", module: "HR" },

      // FINANCE
      { name: "ACCESS_FINANCE", module: "FINANCE" },
      { name: "CREATE_INVOICE", module: "FINANCE" },
      { name: "RECORD_PAYMENT", module: "FINANCE" },
      { name: "CREATE_EXPENSE", module: "FINANCE" },

      // REPORTS
      { name: "ACCESS_REPORTS", module: "REPORTS" },
      { name: "VIEW_ANALYTICS", module: "ANALYTICS" },

      // BRANCH SETTINGS
      { name: "ACCESS_BRANCH_SETTINGS", module: "BRANCH_SETTINGS" },
    ]);

    const getPermissionIds = (names) =>
      permissions.filter((p) => names.includes(p.name)).map((p) => p._id);

    // ======================
    // CREATE ROLES
    // ======================

    await Role.create([
      // ===== SUPER ADMIN =====
      {
        name: "SUPER_ADMIN",
        permissions: permissions.map((p) => p._id),
      },

      // ===== CORPORATE ADMIN =====
      {
        name: "CORPORATE_ADMIN",
        permissions: getPermissionIds([
          "ACCESS_ORGANIZATION",
          "VIEW_ORGANIZATION",
          "ADD_ORGANIZATION",
          "EDIT_ORGANIZATION",
          "BLOCK_ORGANIZATION",
          "DELETE_ORGANIZATION",
          "ACCESS_BRANCH",
          "VIEW_BRANCH",
          "ADD_BRANCH",
          "EDIT_BRANCH",
          "BLOCK_BRANCH",
          "DELETE_BRANCH",
          "ACCESS_ANALYTICS",
          "ACCESS_AUDIT",
          "ACCESS_REPORTS",
        ]),
      },

      // ===== BRANCH MANAGER =====
      {
        name: "BRANCH_MANAGER",
        permissions: getPermissionIds([
          "ACCESS_ROOMS",
          "ACCESS_BOOKINGS",
          "ACCESS_CRM",
          "ACCESS_HOUSEKEEPING",
          "ACCESS_POS",
          "ACCESS_INVENTORY",
          "ACCESS_HR",
          "ACCESS_FINANCE",
          "ACCESS_REPORTS",
          "ACCESS_BRANCH_SETTINGS",
          "ACCESS_BRANCH",
          "VIEW_BRANCH",
          "ADD_BRANCH",
          "EDIT_BRANCH",
          "BLOCK_BRANCH",
          "DELETE_BRANCH",
          "CREATE_TASK",
          "ADD_GUEST",
        ]),
      },

      // ===== RECEPTIONIST =====
      {
        name: "RECEPTIONIST",
        permissions: getPermissionIds([
          "ACCESS_BOOKINGS",
          "ACCESS_CRM",
          "ADD_GUEST",
          "ACCESS_ROOMS",
        ]),
      },

      // ===== ACCOUNTANT =====
      {
        name: "ACCOUNTANT",
        permissions: getPermissionIds(["ACCESS_FINANCE", "ACCESS_REPORTS"]),
      },

      // ===== HOUSEKEEPING =====
      {
        name: "HOUSEKEEPING",
        permissions: getPermissionIds(["ACCESS_HOUSEKEEPING", "CREATE_TASK"]),
      },

      // ===== HR MANAGER =====
      {
        name: "HR_MANAGER",
        permissions: getPermissionIds(["ACCESS_HR"]),
      },

      // ===== RESTAURANT MANAGER =====
      {
        name: "RESTAURANT_MANAGER",
        permissions: getPermissionIds([
          "ACCESS_POS",
          "CREATE_POS_ORDER",
          "UPDATE_POS_ORDER",
          "VOID_POS_ORDER",
          "MANAGE_POS_MENU",
        ]),
      },
    ]);

    console.log("Enterprise RBAC Seeding Completed ✅");
    process.exit();
  } catch (error) {
    console.error("RBAC Seeding Error:", error);
    process.exit(1);
  }
};

seedRBAC();
