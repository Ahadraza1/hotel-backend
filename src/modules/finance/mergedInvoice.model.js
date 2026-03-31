const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const mergedInvoiceSchema = new mongoose.Schema(
  {
    mergedInvoiceId: {
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
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
    },
    roomInvoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
    },
    posOrderIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "POSOrder",
      },
    ],
    totalAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

mergedInvoiceSchema.index({ branchId: 1, createdAt: -1 });
mergedInvoiceSchema.index({ bookingId: 1 }, { unique: true });

module.exports = mongoose.model("MergedInvoice", mergedInvoiceSchema);
