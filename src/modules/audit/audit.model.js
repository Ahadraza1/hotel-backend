const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const auditSchema = new mongoose.Schema(
  {
    auditId: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    role: {
      type: String,
      required: true,
    },

    organizationId: {
      type: String,
      index: true,
    },

    branchId: {
      type: String,
      index: true,
    },

    action: {
      type: String,
      required: true,
    },

    message: {
      type: String,
      default: "",
    },

    module: {
      type: String,
      required: true,
    },

    metadata: {
      type: Object,
    },

    ipAddress: {
      type: String,
    },

    userAgent: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditLog", auditSchema);
