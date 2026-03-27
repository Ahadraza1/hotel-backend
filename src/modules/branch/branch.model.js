const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const branchSchema = new mongoose.Schema(
  {
    branchId: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },

    organizationId: {
      type: String, // CHANGE TYPE
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    address: {
      type: String,
      trim: true,
    },

    taxNumber: {
      type: String,
      trim: true,
    },

    currency: {
      type: String,
      required: true,
    },

    timezone: {
      type: String,
      required: true,
    },

    contactNumber: {
      type: String,
      trim: true,
    },

    /*
      TOTAL ROOMS
    */
    totalRooms: {
      type: Number,
      default: 0,
    },

    /*
      FLOORS
    */
    floor: {
      type: Number,
      required: true,
      min: 1,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

/*
  Ensure branch name is unique per organization
*/
branchSchema.index({ organizationId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("Branch", branchSchema);
