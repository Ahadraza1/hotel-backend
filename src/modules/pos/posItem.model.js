const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const posItemSchema = new mongoose.Schema(
  {
    itemId: {
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

    categoryId: {
      type: String,
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
    },

    price: {
      type: Number,
      required: true,
    },

    taxPercentage: {
      type: Number,
      default: 0,
    },

    serviceChargePercentage: {
      type: Number,
      default: 0,
    },

    preparationTimeMinutes: {
      type: Number,
      default: 10,
    },

    kitchenStation: {
      type: String,
      enum: ["MAIN_KITCHEN", "BAR", "BAKERY", "ROOM_SERVICE"],
      default: "MAIN_KITCHEN",
      index: true,
    },

    inventoryItemId: {
      type: String,
      default: null,
      index: true,
    },

    inventoryConsumptionQty: {
      type: Number,
      default: 0,
    },

    imageUrl: {
      type: String,
    },

    displayOrder: {
      type: Number,
      default: 0,
    },

    isSoldOut: {
      type: Boolean,
      default: false,
      index: true,
    },

    isAvailable: {
      type: Boolean,
      default: true,
      index: true,
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
  Unique item name per branch
*/
posItemSchema.index(
  { branchId: 1, name: 1 },
  { unique: true }
);

module.exports = mongoose.model("POSItem", posItemSchema);