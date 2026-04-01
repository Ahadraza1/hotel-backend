const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const posSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      default: () => `SES-${uuidv4()}`,
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

    type: {
      type: String,
      enum: ["DINE_IN", "ROOM_SERVICE", "TAKEAWAY"],
      required: true,
      index: true,
    },

    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "POSTable",
      default: null,
      index: true,
    },

    tableNo: {
      type: String,
      default: null,
      index: true,
    },

    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      default: null,
      index: true,
    },

    roomNo: {
      type: String,
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

    status: {
      type: String,
      enum: ["OPEN", "BILL_REQUESTED", "PAID", "CLOSED"],
      default: "OPEN",
      index: true,
    },

    invoiceId: {
      type: String,
      default: null,
      index: true,
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

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

posSessionSchema.index(
  { branchId: 1, type: 1, tableId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isActive: true,
      type: "DINE_IN",
      status: "OPEN",
      tableId: { $exists: true, $type: "objectId" },
    },
  },
);

posSessionSchema.index(
  { branchId: 1, type: 1, roomId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isActive: true,
      type: "ROOM_SERVICE",
      status: "OPEN",
      roomId: { $exists: true, $type: "objectId" },
    },
  },
);

module.exports = mongoose.model("POSSession", posSessionSchema);
