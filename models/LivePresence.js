const mongoose = require("mongoose");

const livePresenceSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    scope: { type: String, enum: ["public", "private"], required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // null per public, numero sessione per private
    privateSessionCounter: { type: Number, default: null, index: true },

    roomId: { type: String, required: true },
    status: { type: String, enum: ["active", "left"], default: "active", index: true },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// public: una sola presence logica per event+public+user
livePresenceSchema.index(
  { eventId: 1, scope: 1, userId: 1 },
  { unique: true, partialFilterExpression: { scope: "public" } }
);

// private: una sola presence logica per event+private+sessione+user
livePresenceSchema.index(
  { eventId: 1, scope: 1, privateSessionCounter: 1, userId: 1 },
  { unique: true, partialFilterExpression: { scope: "private" } }
);

module.exports = mongoose.model("LivePresence", livePresenceSchema);