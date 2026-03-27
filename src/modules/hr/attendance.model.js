const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const attendanceSchema = new mongoose.Schema(
  {
    attendanceId: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },

    organizationId: {
      type: String,
      required: true,
      index: true,
    },

    branchId: {
      type: String,
      required: true,
      index: true,
    },

    staffId: {
      type: String,
      required: true,
      index: true,
    },

    date: {
      type: Date,
      required: true,
      index: true,
    },

    checkInTime: {
      type: Date,
    },

    checkOutTime: {
      type: Date,
    },

    totalHours: {
      type: Number,
      default: 0,
    },

    overtimeHours: {
      type: Number,
      default: 0,
    },

    isLate: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ["PRESENT", "ABSENT", "LEAVE"],
      default: "PRESENT",
      index: true,
    },

    notes: {
      type: String,
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

/*
  Prevent duplicate attendance per staff per day
*/
attendanceSchema.index(
  { staffId: 1, date: 1 },
  { unique: true }
);

module.exports = mongoose.model("Attendance", attendanceSchema);