const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const Booking = require("../modules/booking/booking.model");
const Room = require("../modules/room/room.model");
const Branch = require("../modules/branch/branch.model");

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://ahadr912_db_user:zuen8agbXA9bs9Am@cluster0.4nu0yl6.mongodb.net/?appName=Cluster0";

const guestNames = [
  "John Doe",
  "Alice Smith",
  "Michael Johnson",
  "Emma Brown",
  "David Wilson",
  "Sophia Taylor",
  "Daniel Anderson",
  "Olivia Thomas",
  "James White",
  "Isabella Harris",
];

function randomFromArray(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(start, end) {
  return new Date(
    start.getTime() + Math.random() * (end.getTime() - start.getTime())
  );
}

async function seedBookings() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB Connected");

    const branches = await Branch.find();

    if (branches.length === 0) {
      console.log("❌ No branches found");
      process.exit();
    }

    for (const branch of branches) {
      console.log(`📍 Seeding bookings for branch: ${branch._id}`);

      const rooms = await Room.find({
        branchId: branch._id,
        isActive: true,
      });

      if (rooms.length === 0) {
        console.log("⚠ No active rooms in this branch");
        continue;
      }

      const bookings = [];

      for (let i = 0; i < 30; i++) {
        const room = randomFromArray(rooms);

        const checkIn = randomDate(
          new Date(2026, 0, 1),
          new Date(2026, 5, 1)
        );

        const nights = Math.floor(Math.random() * 5) + 1;

        const checkOut = new Date(checkIn);
        checkOut.setDate(checkIn.getDate() + nights);

        bookings.push({
          bookingId: uuidv4(),
          organizationId: branch.organizationId,
          branchId: branch._id,
          roomId: room._id,
          guestName: randomFromArray(guestNames),
          guestPhone: "9999999999",
          guestEmail: `guest${i}@mail.com`,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          nights,
          totalAmount: nights * room.pricePerNight,
          status: "CONFIRMED",
          paymentStatus: "PENDING",
          createdBy: room.createdBy,
        });
      }

      await Booking.insertMany(bookings);
      console.log(`✅ 30 bookings created for branch ${branch._id}`);
    }

    console.log("🎉 Booking seeding completed");
    process.exit();
  } catch (error) {
    console.error("❌ Seeder failed:", error);
    process.exit(1);
  }
}

seedBookings();