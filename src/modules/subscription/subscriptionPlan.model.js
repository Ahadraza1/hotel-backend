const mongoose = require("mongoose");

const subscriptionPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    monthlyPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    yearlyPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    branchLimit: {
      type: Number,
      default: null,
      min: 1,
    },
    features: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isPopular: {
      type: Boolean,
      default: false,
    },
    featureFlags: {
      type: [String],
      enum: [
        "ROOM_MANAGEMENT",
        "HOUSEKEEPING",
        "INVENTORY",
        "HR",
        "ANALYTICS",
        "INVOICE",
        "RESTAURANT",
      ],
      default: [],
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("SubscriptionPlan", subscriptionPlanSchema);
