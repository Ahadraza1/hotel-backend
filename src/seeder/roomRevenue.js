const mongoose = require("mongoose");
const Invoice = require("../modules/invoice/invoice.model");
const Branch = require("../modules/branch/branch.model");

async function seedRoomRevenue() {
  await mongoose.connect("mongodb+srv://ahadr912_db_user:zuen8agbXA9bs9Am@cluster0.4nu0yl6.mongodb.net/?appName=Cluster0");

  console.log("MongoDB connected");

  const branches = await Branch.find({ isActive: true });

  const userId = new mongoose.Types.ObjectId();
  const invoices = [];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const todayDate = now.getDate();

  // 🔥 QUARTER CALCULATION
  const quarterStartMonth = currentMonth - (currentMonth % 3);

  for (const branch of branches) {

    console.log("Seeding branch:", branch._id.toString());

    /* ================= TODAY ================= */
    for (let i = 0; i < 10; i++) {
      const amount = 3000 + Math.floor(Math.random() * 3000);

      invoices.push({
        organizationId: branch.organizationId,
        branchId: branch._id,
        type: "ROOM",
        referenceType: "BOOKING",

        lineItems: [
          {
            description: "Room Booking",
            quantity: 1,
            unitPrice: amount,
            total: amount,
          },
        ],

        totalAmount: amount,
        finalAmount: amount,
        paidAmount: amount,
        dueAmount: 0,

        status: "PAID",
        isActive: true,

        paymentHistory: [
          {
            amount,
            method: "CASH",
            recordedBy: userId,
          },
        ],

        createdBy: userId,

        // ✅ TODAY DATA
        createdAt: new Date(currentYear, currentMonth, todayDate, Math.floor(Math.random() * 24)),
      });
    }

    /* ================= MONTHLY ================= */
    for (let week = 1; week <= 4; week++) {
      const amount = 5000 + Math.floor(Math.random() * 4000);

      invoices.push({
        organizationId: branch.organizationId,
        branchId: branch._id,
        type: "ROOM",
        referenceType: "BOOKING",

        lineItems: [
          {
            description: "Room Booking",
            quantity: 1,
            unitPrice: amount,
            total: amount,
          },
        ],

        totalAmount: amount,
        finalAmount: amount,
        paidAmount: amount,
        dueAmount: 0,

        status: "PAID",
        isActive: true,

        paymentHistory: [
          {
            amount,
            method: "CASH",
            recordedBy: userId,
          },
        ],

        createdBy: userId,

        // ✅ CURRENT MONTH (weekly)
        createdAt: new Date(currentYear, currentMonth, week * 5),
      });
    }

    /* ================= QUARTERLY ================= */
    for (let m = quarterStartMonth; m < quarterStartMonth + 3; m++) {
      const amount = 7000 + Math.floor(Math.random() * 5000);

      invoices.push({
        organizationId: branch.organizationId,
        branchId: branch._id,
        type: "ROOM",
        referenceType: "BOOKING",

        lineItems: [
          {
            description: "Room Booking",
            quantity: 1,
            unitPrice: amount,
            total: amount,
          },
        ],

        totalAmount: amount,
        finalAmount: amount,
        paidAmount: amount,
        dueAmount: 0,

        status: "PAID",
        isActive: true,

        paymentHistory: [
          {
            amount,
            method: "CASH",
            recordedBy: userId,
          },
        ],

        createdBy: userId,

        // ✅ QUARTER DATA
        createdAt: new Date(currentYear, m, 10),
      });
    }

    /* ================= YEARLY ================= */
    for (let m = 0; m < 12; m++) {
      const amount = 6000 + Math.floor(Math.random() * 6000);

      invoices.push({
        organizationId: branch.organizationId,
        branchId: branch._id,
        type: "ROOM",
        referenceType: "BOOKING",

        lineItems: [
          {
            description: "Room Booking",
            quantity: 1,
            unitPrice: amount,
            total: amount,
          },
        ],

        totalAmount: amount,
        finalAmount: amount,
        paidAmount: amount,
        dueAmount: 0,

        status: "PAID",
        isActive: true,

        paymentHistory: [
          {
            amount,
            method: "CASH",
            recordedBy: userId,
          },
        ],

        createdBy: userId,

        // ✅ FULL YEAR DATA
        createdAt: new Date(currentYear, m, 15),
      });
    }
  }

  await Invoice.deleteMany({});
  await Invoice.insertMany(invoices);

  console.log("🔥 Smart Revenue Seeded (Today + Month + Quarter + Year)");

  process.exit();
}

seedRoomRevenue();
