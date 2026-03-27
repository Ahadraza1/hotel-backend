const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const inventorySchema = new mongoose.Schema(
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

    name: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      required: true,
      index: true,
    },

    unit: {
      type: String,
      required: true, // pcs, kg, liter etc.
    },

    quantityAvailable: {
      type: Number,
      required: true,
      default: 0,
    },

    costPerUnit: {
      type: Number,
      required: true,
      default: 0,
    },

    minimumStockLevel: {
      type: Number,
      default: 5,
    },

    lastRestockedAt: {
      type: Date,
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
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/*
  Virtual: Total Stock Value
*/
inventorySchema.virtual("totalStockValue").get(function () {
  return this.quantityAvailable * this.costPerUnit;
});

/*
  Virtual: Stock Status
*/
inventorySchema.virtual("stockStatus").get(function () {
  if (this.quantityAvailable === 0) return "OUT_OF_STOCK";
  if (this.quantityAvailable <= this.minimumStockLevel)
    return "LOW_STOCK";
  return "IN_STOCK";
});

/*
  Unique item per branch
*/
inventorySchema.index({ branchId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("InventoryItem", inventorySchema);