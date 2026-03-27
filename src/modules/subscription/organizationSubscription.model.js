const mongoose = require("mongoose");

const organizationSubscriptionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      default: null,
    },
    billingCycle: {
      type: String,
      enum: ["monthly", "yearly"],
      required: true,
    },
    subscriptionStartDate: {
      type: Date,
      default: null,
    },
    subscriptionEndDate: {
      type: Date,
      default: null,
    },
    trialStartDate: {
      type: Date,
      default: null,
    },
    trialEndDate: {
      type: Date,
      default: null,
    },
    subscriptionStatus: {
      type: String,
      enum: ["active", "expired", "trial", "cancelled"],
      default: "trial",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "success", "failed", "not_required"],
      default: "pending",
      index: true,
    },
    planSnapshot: {
      name: { type: String, required: true },
      description: { type: String, default: "" },
      monthlyPrice: { type: Number, required: true },
      yearlyPrice: { type: Number, required: true },
      branchLimit: { type: Number, default: null },
      features: { type: [String], default: [] },
    },
    payment: {
      provider: { type: String, default: "manual" },
      orderId: { type: String, default: null },
      paymentId: { type: String, default: null },
      signature: { type: String, default: null },
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

organizationSubscriptionSchema.virtual("startDate").get(function getStartDate() {
  return this.subscriptionStartDate || this.trialStartDate || null;
});

organizationSubscriptionSchema.virtual("expiryDate").get(function getExpiryDate() {
  return this.subscriptionEndDate || this.trialEndDate || null;
});

organizationSubscriptionSchema.virtual("status").get(function getStatus() {
  return this.subscriptionStatus;
});

module.exports = mongoose.model(
  "OrganizationSubscription",
  organizationSubscriptionSchema,
);
