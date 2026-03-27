const mongoose = require("mongoose");

const invitationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    role: {
      type: String,
      required: true,
    },

    salary: {
      type: Number,
      required: true,
    },

    organizationId: {
      type: String, // ✅ FIXED (was ObjectId)
      required: true,
      index: true,
    },

    branchId: {
      type: String, // ✅ FIXED (was ObjectId)
      index: true,
    },

    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    token: {
      type: String,
      required: true,
      unique: true,
    },

    status: {
      type: String,
      enum: ["pending", "accepted", "expired"],
      default: "pending",
    },

    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

// Auto remove expired invites (Mongo TTL Index)
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("Invitation", invitationSchema);
