const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
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
    module: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ organizationId: 1, module: 1, createdAt: -1 });
notificationSchema.index({ branchId: 1, module: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
