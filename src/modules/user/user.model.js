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
      enum: [
        "SUPER_ADMIN",
        "CORPORATE_ADMIN",
        "BRANCH_MANAGER",
        "RECEPTIONIST",
        "ACCOUNTANT",
        "HOUSEKEEPING",
        "HR_MANAGER",
        "RESTAURANT_MANAGER",
      ],
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

    isActive: {
      type: Boolean,
      default: false,
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
