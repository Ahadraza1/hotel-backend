const mongoose = require("mongoose");

const invitationAuditSchema = new mongoose.Schema(
  {
    invitationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invitation",
      required: true,
    },

    action: {
      type: String,
      enum: ["CREATED", "RESENT", "CANCELLED", "ACCEPTED", "ROLE_CHANGED"],
      required: true,
    },

    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    metadata: {
      type: Object,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("InvitationAudit", invitationAuditSchema);
