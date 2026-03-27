const mongoose = require("mongoose");

// 🔥 IMPORTANT: Register Permission model
require("./permission.model");

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
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

module.exports = mongoose.model("Role", roleSchema);