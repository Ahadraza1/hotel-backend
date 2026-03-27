const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const guestSchema = new mongoose.Schema(
  {
    guestId: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },

    organizationId: {
      type: String, // ✅ make consistent with other modules
      required: true,
      index: true,
    },

    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },

    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },

    phone: {
      type: String,
      trim: true,
      index: true,
    },

    nationality: {
      type: String,
      trim: true,
    },

    idProofType: {
      type: String,
      enum: ["PASSPORT", "NATIONAL_ID", "DRIVING_LICENSE"],
    },

    idProofNumber: {
      type: String,
      trim: true,
    },

    dateOfBirth: {
      type: Date,
    },

    loyaltyPoints: {
      type: Number,
      default: 0,
    },

    totalStays: {
      type: Number,
      default: 0,
    },

    totalSpent: {
      type: Number,
      default: 0,
    },

    vipStatus: {
      type: Boolean,
      default: false,
      index: true,
    },

    /* CRM Analytics Fields */

    totalGuests: {
      type: Number,
      default: 0,
    },

    lastStay: {
      type: Date,
    },

    currentStatus: {
      type: String,
      enum: ["CHECKED_IN", "CHECKED_OUT", "CONFIRMED"],
    },

    documents: [
      {
        type: String, // uploaded file name
      },
    ],

    bookingHistory: [
      {
        bookingId: String,
        roomId: mongoose.Schema.Types.ObjectId,
        checkInDate: Date,
        checkOutDate: Date,
        totalAmount: Number,
        status: String,
      },
    ],

    blacklisted: {
      type: Boolean,
      default: false,
      index: true,
    },

    notes: {
      type: String,
      trim: true,
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
    },
  },
  { timestamps: true },
);

/*
  Prevent duplicate guest per branch (email or phone)
*/
guestSchema.index({ branchId: 1, email: 1 }, { unique: true, sparse: true });

guestSchema.index({ branchId: 1, phone: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Guest", guestSchema);
