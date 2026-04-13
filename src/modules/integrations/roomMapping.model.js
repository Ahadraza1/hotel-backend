const mongoose = require("mongoose");

const roomMappingSchema = new mongoose.Schema(
  {
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: true,
      index: true,
    },
    externalRoomName: {
      type: String,
      required: true,
      trim: true,
    },
    internalRoomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      index: true,
    },
  },
  { timestamps: true },
);

roomMappingSchema.index(
  { branchId: 1, externalRoomName: 1 },
  { unique: true },
);

module.exports = mongoose.model("RoomMapping", roomMappingSchema);
