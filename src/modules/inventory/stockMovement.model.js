const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const stockMovementSchema = new mongoose.Schema(
  {
    movementId: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },

    itemId: {
      type: String,
      required: true,
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

    type: {
      type: String,
      enum: ["IN", "OUT"],
      required: true,
    },

    quantity: {
      type: Number,
      required: true,
    },

    note: {
      type: String,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StockMovement", stockMovementSchema);
