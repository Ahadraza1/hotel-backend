const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Staff = require("../modules/hr/staff.model");
const Branch = require("../modules/branch/branch.model");
const { v4: uuidv4 } = require("uuid");

dotenv.config();

const MONGO_URI = "mongodb+srv://ahadr912_db_user:zuen8agbXA9bs9Am@cluster0.4nu0yl6.mongodb.net/?appName=Cluster0";

const departments = [
  "FRONT_OFFICE",
  "HOUSEKEEPING",
  "RESTAURANT",
  "FINANCE",
  "HR",
  "MAINTENANCE",
  "MANAGEMENT",
];

const designations = {
  FRONT_OFFICE: ["RECEPTIONIST", "FRONT DESK EXECUTIVE"],
  HOUSEKEEPING: ["HOUSEKEEPER", "SUPERVISOR"],
  RESTAURANT: ["WAITER", "CHEF"],
  FINANCE: ["ACCOUNTANT"],
  HR: ["HR EXECUTIVE"],
  MAINTENANCE: ["TECHNICIAN"],
  MANAGEMENT: ["MANAGER"],
};

const firstNames = [
  "Ali", "Ahmed", "Sara", "Ayesha", "John",
  "Sophia", "Daniel", "Emily", "Michael",
  "Olivia", "David", "Emma", "Noah",
  "Liam", "Mason", "Isabella", "Lucas",
  "Ethan", "James", "Mia",
];

async function seedStaff() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB Connected ✅");

    const branches = await Branch.find();

    if (!branches.length) {
      console.log("No branches found ❌");
      process.exit();
    }

    for (const branch of branches) {
      console.log(`Seeding staff for branch: ${branch.name}`);

      // Delete existing staff of branch
      await Staff.deleteMany({ branchId: branch._id.toString() });

      const staffData = [];

      for (let i = 0; i < 20; i++) {
        const department =
          departments[Math.floor(Math.random() * departments.length)];

        const deptDesignations = designations[department];
        const designation =
          deptDesignations[
            Math.floor(Math.random() * deptDesignations.length)
          ];

        staffData.push({
          staffId: uuidv4(),
          organizationId: branch.organizationId,
          branchId: branch._id.toString(),
          firstName: firstNames[i],
          lastName: "Khan",
          email: `staff${i + 1}_${branch._id}@hotel.com`,
          phone: `0300${Math.floor(1000000 + Math.random() * 9000000)}`,
          department,
          designation,
          employmentType: "FULL_TIME",
          salary: 2000 + Math.floor(Math.random() * 3000),
          overtimeRatePerHour: 20,
          shiftStart: "09:00",
          shiftEnd: "18:00",
          joiningDate: new Date(2024, 0, 1),
          createdBy: new mongoose.Types.ObjectId(), // dummy user
        });
      }

      await Staff.insertMany(staffData);

      console.log(`✅ 20 staff created for ${branch.name}`);
    }

    console.log("🎉 Staff seeding completed");
    process.exit();
  } catch (error) {
    console.error("Seeder failed ❌", error.message);
    process.exit(1);
  }
}

seedStaff();