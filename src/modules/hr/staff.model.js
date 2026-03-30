const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const staffSchema = new mongoose.Schema(
  {
    staffId: {
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

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },

    phone: {
      type: String,
      trim: true,
    },

    department: {
      type: String,
      enum: [
        "FRONT_OFFICE",
        "HOUSEKEEPING",
        "RESTAURANT",
        "ACCOUNTS",
        "FINANCE",
        "HR",
        "MAINTENANCE",
        "MANAGEMENT",
      ],
      required: true,
      index: true,
    },

    designation: {
      type: String,
      required: true,
    },

    employmentType: {
      type: String,
      enum: ["FULL_TIME", "PART_TIME", "CONTRACT"],
      default: "FULL_TIME",
    },

    salary: {
      type: Number,
      required: true,
      default: 0,
    },

    overtimeRatePerHour: {
      type: Number,
      default: 0,
    },

    shiftStart: {
      type: String, // e.g., "09:00"
    },

    shiftEnd: {
      type: String, // e.g., "18:00"
    },

    leaveBalance: {
      type: Number,
      default: 12, // annual leaves
    },

    performanceRating: {
      type: Number,
      min: 1,
      max: 5,
      default: 3,
    },

    joiningDate: {
      type: Date,
      required: true,
      default: Date.now,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

/*
  Unique staff email per branch
*/
staffSchema.index(
  { branchId: 1, email: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model("Staff", staffSchema);
