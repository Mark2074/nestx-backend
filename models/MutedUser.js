const mongoose = require("mongoose");

const MutedUserSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    mutedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

MutedUserSchema.index({ userId: 1, mutedUserId: 1 }, { unique: true });

module.exports = mongoose.model("MutedUser", MutedUserSchema);
