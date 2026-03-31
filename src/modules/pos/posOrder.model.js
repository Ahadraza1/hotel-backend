const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const orderItemSchema = new mongoose.Schema(
{
  itemId: {
    type: String,
    required: true,
  },

  nameSnapshot: {
    type: String,
    required: true,
  },

  priceSnapshot: {
    type: Number,
    required: true,
  },

  taxPercentageSnapshot: {
    type: Number,
    default: 0,
  },

  serviceChargePercentageSnapshot: {
    type: Number,
    default: 0,
  },

  quantity: {
    type: Number,
    required: true,
    min: 1,
  },

  totalItemAmount: {
    type: Number,
    required: true,
  },

  kitchenStatus: {
    type: String,
    enum: ["PENDING","PREPARING","READY","SERVED"],
    default: "PENDING",
  },

  kitchenStation: {
    type: String,
    default: "MAIN_KITCHEN",
  }

},
{ _id: false }
);

const posOrderSchema = new mongoose.Schema(
{

  /* 🔥 UNIQUE ORDER ID (FIX DUPLICATE ERROR) */
  orderId: {
    type: String,
    default: () => uuidv4(),
    unique: true,
    index: true,
  },

  orderNumber: {
    type: Number,
    required: true,
  },

  orderCode: {
    type: String,
    required: true,
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

  tableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "POSTable",
    default: null,
    index: true,
  },

  tableNumber: {
    type: String,
  },

  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Room",
    default: null,
    index: true,
  },

  bookingId: {
    type: String,
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
    enum: ["DINE_IN","ROOM_SERVICE","TAKEAWAY"],
    required: true,
    index: true,
  },

  items: [orderItemSchema],

  subTotal: {
    type: Number,
    required: true,
  },

  totalTax: {
    type: Number,
    default: 0,
  },

  totalServiceCharge: {
    type: Number,
    default: 0,
  },

  discountAmount: {
    type: Number,
    default: 0,
  },

  discountPercentage: {
    type: Number,
    default: 0,
  },

  grandTotal: {
    type: Number,
    required: true,
  },

  paymentStatus: {
    type: String,
    enum: ["UNPAID","PAID","REFUNDED"],
    default: "UNPAID",
    index: true,
  },

  paymentMethod: {
    type: String,
    enum: ["CASH","CARD","UPI","BANK_TRANSFER"],
  },

  orderStatus: {
    type: String,
    enum: [
      "OPEN",
      "PREPARING",
      "READY",
      "SERVED",
      "COMPLETED",
      "IN_PROGRESS",
      "CANCELLED",
    ],
    default: "OPEN",
    index: true,
  },

  invoiceLinked: {
    type: Boolean,
    default: false,
  },

  invoiceId: {
    type: String,
    default: null,
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  isActive: {
    type: Boolean,
    default: true,
    index: true,
  }

},
{ timestamps: true }
);

module.exports = mongoose.model("POSOrder", posOrderSchema);
