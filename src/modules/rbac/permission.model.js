const mongoose = require("mongoose");

const permissionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    key: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    module: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    description: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

permissionSchema.pre("validate", function (next) {
  if (!this.key && this.name) {
    this.key = this.name;
  }

  if (this.key) {
    this.key = this.key.trim().toUpperCase();
  }

  if (this.module) {
    this.module = this.module.trim().toUpperCase();
  }

  next();
});

module.exports = mongoose.model("Permission", permissionSchema);
