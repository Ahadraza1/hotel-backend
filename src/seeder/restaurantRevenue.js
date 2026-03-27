const mongoose = require("mongoose");
const POSOrder = require("../modules/pos/posOrder.model");
const Branch = require("../modules/branch/branch.model");

async function seedRestaurantRevenue() {

  await mongoose.connect("mongodb+srv://ahadr912_db_user:zuen8agbXA9bs9Am@cluster0.4nu0yl6.mongodb.net/?appName=Cluster0");

  console.log("MongoDB connected");

  const branches = await Branch.find({ isActive: true });

  if (!branches.length) {
    console.log("❌ No branches found");
    process.exit();
  }

  const userId = new mongoose.Types.ObjectId();
  const orders = [];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const todayDate = now.getDate();

  const quarterStartMonth = currentMonth - (currentMonth % 3);

  for (const branch of branches) {

    console.log("Seeding branch:", branch._id.toString());

    /* ================= TODAY ================= */
    for (let i = 0; i < 15; i++) {
      const amount = 200 + Math.floor(Math.random() * 800);

      orders.push({
        organizationId: branch.organizationId,
        branchId: branch._id,
        orderNumber: 1000 + i,
        orderCode: `ORD-T-${1000 + i}`,
        orderType: "DINE_IN",

        items: [
          {
            itemId: new mongoose.Types.ObjectId().toString(),
            nameSnapshot: "Food Item",
            priceSnapshot: amount,
            quantity: 1,
            totalItemAmount: amount,
          },
        ],

        subTotal: amount,
        grandTotal: amount,

        paymentStatus: "PAID",
        isActive: true,

        createdBy: userId,

        // ✅ CURRENT DAY (random hours)
        createdAt: new Date(
          currentYear,
          currentMonth,
          todayDate,
          Math.floor(Math.random() * 24)
        ),
      });
    }

    /* ================= MONTHLY ================= */
    for (let week = 1; week <= 4; week++) {
      const amount = 1000 + Math.floor(Math.random() * 3000);

      orders.push({
        organizationId: branch.organizationId,
        branchId: branch._id,
        orderNumber: 2000 + week,
        orderCode: `ORD-M-${2000 + week}`,
        orderType: "ROOM_SERVICE",

        items: [
          {
            itemId: new mongoose.Types.ObjectId().toString(),
            nameSnapshot: "Combo Meal",
            priceSnapshot: amount / 2,
            quantity: 2,
            totalItemAmount: amount,
          },
        ],

        subTotal: amount,
        grandTotal: amount,

        paymentStatus: "PAID",
        isActive: true,

        createdBy: userId,

        // ✅ CURRENT MONTH (weekly distribution)
        createdAt: new Date(currentYear, currentMonth, week * 5),
      });
    }

    /* ================= QUARTERLY ================= */
    for (let m = quarterStartMonth; m < quarterStartMonth + 3; m++) {
      const amount = 3000 + Math.floor(Math.random() * 5000);

      orders.push({
        organizationId: branch.organizationId,
        branchId: branch._id,
        orderNumber: 3000 + m,
        orderCode: `ORD-Q-${3000 + m}`,
        orderType: "TAKEAWAY",

        items: [
          {
            itemId: new mongoose.Types.ObjectId().toString(),
            nameSnapshot: "Party Order",
            priceSnapshot: amount / 3,
            quantity: 3,
            totalItemAmount: amount,
          },
        ],

        subTotal: amount,
        grandTotal: amount,

        paymentStatus: "PAID",
        isActive: true,

        createdBy: userId,

        // ✅ CURRENT QUARTER
        createdAt: new Date(currentYear, m, 10),
      });
    }

    /* ================= YEARLY ================= */
    for (let m = 0; m < 12; m++) {
      const amount = 5000 + Math.floor(Math.random() * 8000);

      orders.push({
        organizationId: branch.organizationId,
        branchId: branch._id,
        orderNumber: 4000 + m,
        orderCode: `ORD-Y-${4000 + m}`,
        orderType: "DINE_IN",

        items: [
          {
            itemId: new mongoose.Types.ObjectId().toString(),
            nameSnapshot: "Bulk Catering",
            priceSnapshot: amount / 5,
            quantity: 5,
            totalItemAmount: amount,
          },
        ],

        subTotal: amount,
        grandTotal: amount,

        paymentStatus: "PAID",
        isActive: true,

        createdBy: userId,

        // ✅ FULL CURRENT YEAR
        createdAt: new Date(currentYear, m, 15),
      });
    }
  }

  await POSOrder.deleteMany({});
  await POSOrder.insertMany(orders);

  console.log("🔥 Smart Restaurant Revenue Seeded");

  process.exit();
}

seedRestaurantRevenue();