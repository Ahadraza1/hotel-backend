const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const invoiceSchema = new mongoose.Schema(
  {
    // Public-safe ID
    invoiceId: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },

    // Multi-Tenant Isolation
    organizationId: {
      type: String, // ✅ CHANGE TYPE
      required: true,
      index: true,
    },

    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },

    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      default: null,
      index: true,
    },

    guestName: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    orderType: {
      type: String,
      enum: ["DINE_IN", "ROOM_SERVICE", "TAKEAWAY", null],
      default: null,
      index: true,
    },

    type: {
      type: String,
      enum: ["ROOM", "RESTAURANT"],
      required: true,
      index: true,
      default: function () {
        return this.referenceType === "POS" ? "RESTAURANT" : "ROOM";
      },
    },

    /*
  POS reference
*/
    referenceType: {
      type: String,
      enum: ["BOOKING", "POS"],
      required: true,
      index: true,
    },

    referenceId: {
      type: String,
      default: null,
      index: true,
    },

    // Line Items (Room, Extra Services, etc.)
    lineItems: [
      {
        description: String,
        quantity: { type: Number, default: 1 },
        unitPrice: { type: Number, required: true },
        total: { type: Number, required: true },
      },
    ],

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    serviceChargeAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    finalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Payment Tracking
    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    dueAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ["UNPAID", "PARTIALLY_PAID", "PAID"],
      default: "UNPAID",
      index: true,
    },

    paymentHistory: [
      {
        amount: Number,
        method: {
          type: String,
          enum: ["CASH", "CARD", "UPI", "BANK_TRANSFER"],
        },
        paidAt: {
          type: Date,
          default: Date.now,
        },
        recordedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      },
    ],

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

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    pdfUrl: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

/*
  Performance Indexes
*/
invoiceSchema.index({ branchId: 1, status: 1 });
invoiceSchema.index({ branchId: 1, createdAt: -1 });
invoiceSchema.index({ organizationId: 1, createdAt: -1 });
invoiceSchema.index({ branchId: 1, referenceType: 1, createdAt: -1 });
invoiceSchema.index({ branchId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("Invoice", invoiceSchema);
