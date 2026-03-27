const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const organizationSchema = new mongoose.Schema(
  {
    organizationId: {
      type: String,
      default: () => uuidv4(),
      unique: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    businessType: {
      type: String,
      default: "HOTEL",
      trim: true,
      uppercase: true,
    },

    numberOfBranches: {
      type: Number,
      default: null,
      min: 1,
    },

    country: {
      type: String,
      default: "",
      trim: true,
    },

    state: {
      type: String,
      default: "",
      trim: true,
    },

    city: {
      type: String,
      default: "",
      trim: true,
    },

    logoUrl: {
      type: String,
      default: null,
    },

    systemIdentifier: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    headquartersAddress: {
      type: String,
      required: true,
      trim: true,
    },

    taxId: {
      type: String,
      default: null,
      trim: true,
    },

    contactPhone: {
      type: String,
      default: "",
      trim: true,
    },

    serviceTier: {
      type: String,
      enum: ["STARTER", "PROFESSIONAL", "ENTERPRISE"],
      default: "STARTER",
    },

    currency: {
      type: String,
      required: true,
    },

    timezone: {
      type: String,
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // NEW FIELD - Organization Block Status
    isBlocked: {
      type: Boolean,
      default: false,
    },

    // When it was blocked
    blockedAt: {
      type: Date,
      default: null,
    },

    // Who blocked it
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Organization", organizationSchema);
