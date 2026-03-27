const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const posCategorySchema = new mongoose.Schema(
  {
    categoryId: {
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

    description: {
      type: String,
      trim: true,
    },

    type: {
      type: String,
      enum: ["FOOD", "BEVERAGE", "BAR", "ROOM_SERVICE"],
      default: "FOOD",
      index: true,
    },

    displayOrder: {
      type: Number,
      default: 0,
    },

    image: {
      type: String,
      default: null,
    },

    color: {
      type: String,
      default: "#C9A54C"
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
  Unique category name per branch
*/
posCategorySchema.index(
  { branchId: 1, name: 1 },
  { unique: true }
);

module.exports = mongoose.model("POSCategory", posCategorySchema);