const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const posTableSchema = new mongoose.Schema(
  {
    tableId: {
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

    tableNumber: {
      type: String,
      trim: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    seats: {
      type: Number,
      default: 2,
    },

    tableType: {
      type: String,
      enum: ["REGULAR", "VIP", "PRIVATE_DINING"],
      default: "REGULAR",
      index: true,
    },

    status: {
      type: String,
      enum: ["AVAILABLE", "OCCUPIED", "RESERVED"],
      default: "AVAILABLE",
      index: true,
    },

    location: {
      type: String,
      trim: true,
    },

    displayOrder: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
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
  Unique table name per branch
*/
posTableSchema.index(
  { branchId: 1, name: 1 },
  { unique: true }
);

module.exports = mongoose.model("POSTable", posTableSchema);
