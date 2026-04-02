const mongoose = require("mongoose");

// 🔥 IMPORTANT: Register Permission model
require("./permission.model");

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    normalizedName: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    type: {
      type: String,
      enum: ["SYSTEM", "CUSTOM"],
      default: "CUSTOM",
    },

    category: {
      type: String,
      enum: ["MAIN", "ORGANIZATION", "BRANCH"],
      default: "BRANCH",
    },

    organizationId: {
      type: String,
      default: null,
      index: true,
    },

    branchId: {
      type: String,
      default: null,
      index: true,
    },

    permissions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Permission",
      },
    ],
  },
  { timestamps: true }
);

roleSchema.index(
  { normalizedName: 1, organizationId: 1, branchId: 1 },
  { unique: true, name: "uniq_role_name_per_scope" },
);

roleSchema.pre("validate", function () {
  if (this.name) {
    this.name = this.name.trim();
    this.normalizedName = this.name.toUpperCase().replace(/\s+/g, "_");
  }

  if (this.category === "BRANCH") {
    this.branchId = this.branchId ? String(this.branchId).trim() : null;
  } else {
    this.branchId = null;
  }

  this.organizationId = this.organizationId
    ? String(this.organizationId).trim()
    : null;
});

module.exports = mongoose.model("Role", roleSchema);
