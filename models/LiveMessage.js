// models/LiveMessage.js
const mongoose = require("mongoose");

const liveMessageSchema = new mongoose.Schema(
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
      index: true,
    },
    privateSessionCounter: {
      type: Number,
      default: null,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    moderation: {
      status: { type: String, enum: ["visible", "under_review", "hidden"], default: "visible", index: true },
      hiddenBy: { type: String, enum: ["ai", "admin"], default: null, index: true },
      hiddenReason: { type: String, default: null },
      hiddenSeverity: { type: String, enum: ["grave", "gravissimo"], default: null, index: true },
      hiddenCategory: { type: String, default: null, trim: true, lowercase: true, index: true },
      hiddenAt: { type: Date, default: null, index: true },
      hiddenByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      ai: {
        flagged: { type: Boolean, default: false, index: true },
        score: { type: Number, default: 0 },
        labels: { type: [String], default: [] },
        reason: { type: String, default: null },
        provider: { type: String, default: null },
        model: { type: String, default: null },
        reviewedAt: { type: Date, default: null },
      },
    },
  },
  { versionKey: false }
);

// index consigliato
liveMessageSchema.index({
  eventId: 1,
  scope: 1,
  privateSessionCounter: 1,
  createdAt: -1,
});

module.exports = mongoose.model("LiveMessage", liveMessageSchema);