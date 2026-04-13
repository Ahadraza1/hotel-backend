const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const subscriptionPaymentSchema = new mongoose.Schema(
  {
    organizationId: {
      type: String,
      required: true,
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
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["success", "failed", "pending"],
      default: "success",
      index: true,
    },
    paymentDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    provider: {
      type: String,
      default: "manual",
    },
    orderId: {
      type: String,
      default: null,
    },
    paymentId: {
      type: String,
      default: null,
    },
    signature: {
      type: String,
      default: null,
    },
    invoiceId: {
      type: String,
      default: () => `SUB-${uuidv4().split("-")[0].toUpperCase()}`,
      index: true,
    },
    invoicePdfPath: {
      type: String,
      default: null,
    },
    billingPeriodStart: {
      type: Date,
      default: null,
    },
    billingPeriodEnd: {
      type: Date,
      default: null,
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "SubscriptionPayment",
  subscriptionPaymentSchema,
);
