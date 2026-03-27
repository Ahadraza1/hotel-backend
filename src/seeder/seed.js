require("dotenv").config();
const connectDB = require("../config/db");
const User = require("../modules/user/user.model");

const seedPlatformAdmin = async () => {
  try {
    await connectDB();

    console.log("Seeding Platform Super Admin...");

    // Check if already exists
    const existingAdmin = await User.findOne({ role: "SUPER_ADMIN" });

    if (existingAdmin) {
      console.log("Platform Super Admin already exists.");
      process.exit();
    }

    // Create Platform Super Admin
    await User.create({
      organizationId: null,
      branchId: null,
      role: "SUPER_ADMIN",
      isPlatformAdmin: true,
      name: "Platform Owner",
      email: "superadmin@hotel.com",
      password: "superadmin@123", // Will be auto hashed by pre-hook
    });

    console.log("✅ Platform Super Admin Created Successfully");
    process.exit();

  } catch (error) {
    console.error("Seeding error:", error);
    process.exit(1);
  }
};

seedPlatformAdmin();
