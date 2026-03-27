require("dotenv").config();
const mongoose = require("mongoose");
const Guest = require("../modules/crm/guest.model");
const Branch = require("../modules/branch/branch.model");
const User = require("../modules/user/user.model");

const MONGO_URI = "mongodb+srv://ahadr912_db_user:zuen8agbXA9bs9Am@cluster0.4nu0yl6.mongodb.net/?appName=Cluster0";

/*
  Random Helpers
*/
const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

const firstNames = [
  "James", "Olivia", "Liam", "Emma", "Noah",
  "Ava", "William", "Sophia", "Benjamin", "Isabella",
  "Lucas", "Mia", "Henry", "Charlotte", "Amelia",
  "Ethan", "Harper", "Alexander", "Evelyn", "Daniel"
];

const lastNames = [
  "Smith", "Johnson", "Williams", "Brown", "Jones",
  "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"
];

const nationalities = [
  "American", "Indian", "British", "Canadian",
  "Australian", "German", "French", "Italian"
];

/*
  Seeder Function
*/
const seedGuests = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB Connected");

    const branches = await Branch.find();
    const adminUser = await User.findOne(); // any existing user

    if (!branches.length) {
      console.log("❌ No branches found");
      process.exit();
    }

    for (const branch of branches) {

      console.log(`\n🏨 Seeding guests for branch: ${branch.name}`);

      for (let i = 1; i <= 20; i++) {

        const firstName = randomItem(firstNames);
        const lastName = randomItem(lastNames);

        const email = `${firstName.toLowerCase()}${i}_${branch._id}@mail.com`;
        const phone = `9${Math.floor(100000000 + Math.random() * 900000000)}`;

        await Guest.create({
          organizationId: branch.organizationId, // ✅ from branch
          branchId: branch._id,
          firstName,
          lastName,
          email,
          phone,
          nationality: randomItem(nationalities),
          idProofType: randomItem(["PASSPORT", "NATIONAL_ID", "DRIVING_LICENSE"]),
          idProofNumber: `ID${Math.floor(Math.random() * 9999999)}`,
          dateOfBirth: new Date(1990, 1, i),
          loyaltyPoints: Math.floor(Math.random() * 500),
          totalStays: Math.floor(Math.random() * 10),
          totalSpent: Math.floor(Math.random() * 10000),
          vipStatus: Math.random() > 0.8,
          blacklisted: false,
          notes: "Seeded guest data",
          createdBy: adminUser?._id,
        });

      }

      console.log(`✅ 20 guests created for branch ${branch.name}`);
    }

    console.log("\n🎉 Guest seeding completed successfully");
    process.exit();

  } catch (error) {
    console.error("❌ Seeder failed:", error.message);
    process.exit(1);
  }
};

seedGuests();