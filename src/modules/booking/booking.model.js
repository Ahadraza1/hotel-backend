const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const bookingSchema = new mongoose.Schema(
  {
    // Public-safe ID
    bookingId: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },

    // Multi-Tenant Isolation
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

    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      index: true,
    },

    // Guest Info
    guestName: {
      type: String,
      required: true,
      trim: true,
    },

    guestType: {
      type: String,
      enum: ["ADULT", "CHILD"],
      required: true,
    },

    bookingSource: {
      type: String,
      enum: ["Walk-in", "Pre-booking", "Online"],
      default: "Walk-in",
      trim: true,
    },

    // Additional guests staying
    guests: [
      {
        name: {
          type: String,
          trim: true,
        },
        email: {
          type: String,
          trim: true,
          lowercase: true,
        },
        phone: {
          type: String,
          trim: true,
        },
      },
    ],

    // Number of guests staying
    totalGuests: {
      type: Number,
      default: 1,
      min: 1,
    },

    guestPhone: {
      type: String,
      trim: true,
    },

    guestEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },

    identityDocument: {
      url: {
        type: String,
        trim: true,
        default: null,
      },
      fileName: {
        type: String,
        trim: true,
        default: null,
      },
      fileType: {
        type: String,
        trim: true,
        default: null,
      },
    },

    mainGuestIdentity: {
      type: String,
      trim: true,
      default: null,
    },

    guestsIdentity: {
      type: [
        {
          type: String,
          trim: true,
        },
      ],
      default: [],
    },

    // Stay Details
    // Stay Details
    checkInDate: {
      type: Date,
      required: true,
      index: true,
    },

    checkInTime: {
      type: String,
      trim: true,
    },

    checkOutDate: {
      type: Date,
      required: true,
      index: true,
    },

    checkOutTime: {
      type: String,
      trim: true,
    },

    nights: {
      type: Number,
      required: true,
      min: 1,
    },

    actualCheckIn: {
      type: Date,
      default: null,
    },

    actualCheckOut: {
      type: Date,
      default: null,
    },

    services: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
        },
        price: {
          type: Number,
          required: true,
          min: 0,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
          default: 1,
        },
        total: {
          type: Number,
          required: true,
          min: 0,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // NEW → Track how much paid
    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Payment Tracking
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PARTIAL", "PAID"],
      default: "PENDING",
      index: true,
    },

    paymentMethod: {
      type: String,
      enum: ["CASH", "CARD", "UPI"],
      default: null,
    },

    paymentDate: {
      type: Date,
      default: null,
    },

    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      default: null,
      index: true,
    },

    // Booking Lifecycle
    status: {
      type: String,
      enum: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED"],
      default: "CONFIRMED",
      index: true,
    },

    // Soft Delete
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Audit
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

/*
  Performance Indexes
*/

bookingSchema.index({ roomId: 1, checkInDate: 1, checkOutDate: 1 });
bookingSchema.index({ branchId: 1, status: 1 });
bookingSchema.index({ branchId: 1, checkInDate: 1 });
bookingSchema.index({ branchId: 1, isActive: 1 });

// NEW → Revenue fast query
bookingSchema.index({ paymentStatus: 1, createdAt: 1 });

module.exports = mongoose.model("Booking", bookingSchema);
