const mongoose = require("mongoose");

const liveRoomSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      index: true,
    },
    scope: {
      type: String,
      enum: ["public", "private"],
      required: true,
      default: "public",
      index: true,
    },

    // null per public, numero sessione per private
    privateSessionCounter: {
      type: Number,
      default: null,
      index: true,
    },

    roomId: {
      type: String,
      required: true,
      index: true,
    },
    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "ended"],
      default: "active",
      index: true,
    },
    currentViewersCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    peakViewersCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// room pubblica unica per evento
liveRoomSchema.index(
  { eventId: 1, scope: 1 },
  { unique: true, partialFilterExpression: { scope: "public" } }
);

// room privata unica per evento+sessione
liveRoomSchema.index(
  { eventId: 1, scope: 1, privateSessionCounter: 1 },
  { unique: true, partialFilterExpression: { scope: "private" } }
);

module.exports = mongoose.model("LiveRoom", liveRoomSchema);