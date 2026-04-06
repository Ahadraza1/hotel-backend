const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    organizationId: {
      type: String, // ✅ FIXED
      default: null,
      index: true,
    },

    branchId: {
      type: String,
      default: null,
      index: true,
    },

    // ✅ NEW FIELD — Workspace Context
    activeBranch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },

    role: {
      type: String,
      trim: true,
      required: true,
    },

    roleRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      default: null,
    },

    isPlatformAdmin: {
      type: Boolean,
      default: false,
    },

    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    phone: {
      type: String,
      trim: true,
    },

    avatar: {
      type: String,
      default: null,
    },

    inviteToken: {
      type: String,
      default: null,
    },

    inviteExpiresAt: {
      type: Date,
      default: null,
    },

    passwordResetOtpHash: {
      type: String,
      default: null,
      select: false,
    },

    passwordResetOtpExpiresAt: {
      type: Date,
      default: null,
    },

    passwordResetOtpVerifiedAt: {
      type: Date,
      default: null,
    },

    permissions: [
      {
        type: String,
      },
    ],

    isActive: {
      type: Boolean,
      default: false,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

/*
  Modern Mongoose v7+ safe pre-hook
*/
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

module.exports = mongoose.model("User", userSchema);
