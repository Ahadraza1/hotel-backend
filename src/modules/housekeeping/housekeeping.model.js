const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const housekeepingSchema = new mongoose.Schema(
  {
    housekeepingId: {
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
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },

    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["DIRTY", "ASSIGNED", "IN_PROGRESS", "CLEAN", "INSPECTED"],
      default: "DIRTY",
      index: true,
    },

    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
      default: "MEDIUM",
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    
    notes: {
      type: String,
      trim: true,
    },

    completedAt: {
      type: Date,
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
  { timestamps: true },
);

/*
  Performance Indexes
*/
housekeepingSchema.index({ branchId: 1, status: 1 });
housekeepingSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.model("Housekeeping", housekeepingSchema);
