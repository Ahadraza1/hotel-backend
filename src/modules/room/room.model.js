const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const roomSchema = new mongoose.Schema(
  {
    // Public Room Identifier (Safe for frontend use)
    roomId: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },

    // Multi-Tenant Isolation
    organizationId: {
      type: String, // ✅ CHANGE TYPE
      required: true,
      index: true,
    },

    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },

    // Core Info
    roomNumber: {
      type: String,
      required: true,
      trim: true,
    },

    floor: {
      type: Number,
      default: 1,
    },

    roomType: {
      type: String,
      enum: ["STANDARD", "DELUXE", "SUITE", "PRESIDENTIAL"],
      required: true,
    },

    pricePerNight: {
      type: Number,
      required: true,
      min: 0,
    },

    capacity: {
      type: Number,
      default: 2,
      min: 1,
    },

    maxOccupancy: {
      adults: {
        type: Number,
        required: true,
        min: 0,
      },
      children: {
        type: Number,
        required: true,
        min: 0,
      },
    },

    bedType: {
      type: String,
      enum: ["King", "Queen", "Twin", "Double", "Single"],
      required: true,
    },

    amenities: {
      type: [
        {
          type: String,
          trim: true,
        },
      ],
      required: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: "At least one amenity is required",
      },
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    // Operational Status
    status: {
      type: String,
      enum: ["AVAILABLE", "BOOKED", "OCCUPIED", "MAINTENANCE", "BLOCKED"],
      default: "AVAILABLE",
      index: true,
    },

    manualOverrideActive: {
      type: Boolean,
      default: false,
      index: true,
    },

    manualOverrideStatus: {
      type: String,
      enum: ["AVAILABLE", "MAINTENANCE", "BLOCKED", null],
      default: null,
    },

    housekeepingStatus: {
      type: String,
      enum: ["CLEAN", "DIRTY", "INSPECTION_PENDING"],
      default: "CLEAN",
    },

    // Soft Delete
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Audit Fields
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

/*
  Unique room number per branch if room is active
*/
roomSchema.index(
  { branchId: 1, roomNumber: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

/*
  Performance Indexes for Dashboard Queries
*/
roomSchema.index({ branchId: 1, status: 1 });
roomSchema.index({ branchId: 1, isActive: 1 });

module.exports = mongoose.model("Room", roomSchema);
