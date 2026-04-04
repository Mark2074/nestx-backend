// models/ticket.js
const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    priceTokens: {
      type: Number,
      required: true,
      min: 0,
    },
    purchasedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["active", "refunded"],
      default: "active"
    },
    scope: {
      type: String,
      enum: ["public", "private"],
      default: "public"
    },
    roomId: {
      type: String,
      default: null
    },
    refundedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
  }
);

// ✅ 1 ticket per (eventId, userId, scope, roomId)
ticketSchema.index(
  { eventId: 1, userId: 1, scope: 1, roomId: 1 },
  { unique: true }
);

module.exports = mongoose.model("Ticket", ticketSchema);
