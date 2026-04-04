const mongoose = require("mongoose");

const signupCheckoutSchema = new mongoose.Schema(
  {
    checkoutReference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    customerName: {
      type: String,
      default: "",
      trim: true,
    },
    userEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPlan",
      required: true,
      index: true,
    },
    planSnapshot: {
      name: { type: String, default: "" },
      description: { type: String, default: "" },
      monthlyPrice: { type: Number, default: 0 },
      yearlyPrice: { type: Number, default: 0 },
      branchLimit: { type: Number, default: null },
      features: [{ type: String }],
    },
    billingCycle: {
      type: String,
      enum: ["monthly", "yearly"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "success", "failed", "consumed"],
      default: "pending",
      index: true,
    },
    provider: {
      type: String,
      default: "razorpay",
    },
    orderId: {
      type: String,
      default: null,
      index: true,
    },
    paymentId: {
      type: String,
      default: null,
      index: true,
    },
    signature: {
      type: String,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("SignupCheckout", signupCheckoutSchema);
