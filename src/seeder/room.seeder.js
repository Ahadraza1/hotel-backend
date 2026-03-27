const mongoose = require("mongoose");
const Room = require("../modules/room/room.model");
const Branch = require("../modules/branch/branch.model");
const User = require("../modules/user/user.model");

const seedRooms = async () => {
  try {
   await mongoose.connect("mongodb+srv://ahadr912_db_user:zuen8agbXA9bs9Am@cluster0.4nu0yl6.mongodb.net/?appName=Cluster0");

    console.log("🌱 Seeding rooms...");

    // 🔥 Get all branches
    const branches = await Branch.find();

    if (!branches.length) {
      console.log("❌ No branches found");
      process.exit();
    }

    // 🔥 Get any user for createdBy
    const user = await User.findOne();
    if (!user) {
      console.log("❌ No user found for createdBy");
      process.exit();
    }

    const roomTypes = ["STANDARD", "DELUXE", "SUITE", "PRESIDENTIAL"];

    for (const branch of branches) {
      console.log(`🏨 Seeding rooms for branch: ${branch.name}`);

      // Remove existing rooms for clean seed (optional)
      await Room.deleteMany({ branchId: branch._id });

      const rooms = [];

      for (let i = 1; i <= 20; i++) {
        const roomType =
          roomTypes[Math.floor(Math.random() * roomTypes.length)];

        const basePrice = {
          STANDARD: 100,
          DELUXE: 180,
          SUITE: 300,
          PRESIDENTIAL: 600,
        };

        rooms.push({
          organizationId: branch.organizationId.toString(), // 🔥 String type
          branchId: branch._id,
          roomNumber: (100 + i).toString(),
          floor: Math.ceil(i / 5),
          roomType,
          pricePerNight: basePrice[roomType] + Math.floor(Math.random() * 50),
          capacity: roomType === "PRESIDENTIAL" ? 4 : 2,
          amenities: ["WiFi", "TV", "AC"],
          status: "AVAILABLE",
          isActive: true,
          createdBy: user._id,
        });
      }

      await Room.insertMany(rooms);
    }

    console.log("✅ 20 rooms per branch seeded successfully");
    process.exit();

  } catch (error) {
    console.error("❌ Seeder failed:", error);
    process.exit(1);
  }
};

seedRooms();