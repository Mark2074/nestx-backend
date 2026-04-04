const mongoose = require("mongoose");

const followSchema = new mongoose.Schema(
  {
    followerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    followingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ✅ nuovo: stato relazione
    status: {
      type: String,
      enum: ["pending", "accepted"],
      default: "accepted", // IMPORTANT: i follow su profili pubblici saranno accepted
    },

    requestedAt: {
      type: Date,
      default: Date.now,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// ✅ resta identico: una sola relazione follower->following
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });

module.exports = mongoose.model("FOLLOW", followSchema);
