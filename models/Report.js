const mongoose = require("mongoose");

const ReportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    targetType: {
      type: String,
      enum: ["user", "post", "event", "comment", "live_message"],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    // --- context (Phase 1: live reports) ---
    contextType: {
      type: String,
      enum: ["live"],
      default: null,
      index: true,
    },
    contextId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    // auto severity (P0..P4) - Phase 1
    severity: {
      type: String,
      enum: ["P0", "P1", "P2", "P3", "P4"],
      default: "P4",
      index: true,
    },

    reasonCode: {
      type: String,
      enum: [
        "minor_involved",
        "illegal_content",
        "violent_or_gore_content",
        "violent_extremism_or_propaganda",
        "harassment_or_threats",
        "spam_or_scam",
        "impersonation_or_fake",
        "other",
      ],
      required: true,
      index: true,
    },

    reason: {
      type: String,
      default: null,
      trim: true,
    },

    note: {
      type: String,
    },

    source: {
      type: String,
      enum: ["user", "ai"],
      default: "user",
      index: true,
    },

    aiReview: {
      score: { type: Number, default: 0 },
      labels: { type: [String], default: [] },
      suggestedSeverity: {
        type: String,
        enum: ["grave", "gravissimo", null],
        default: null,
      },
    },

    priorityScore: {
      type: Number,
      default: 4,
      index: true,
    },

    status: {
      type: String,
      enum: ["pending", "hidden", "reviewed", "dismissed", "actioned"],
      default: "pending",
      index: true,
    },
    // valorizzati SOLO quando admin mette status=actioned
    confirmedSeverity: {
      type: String,
      enum: ["grave", "gravissimo"],
      default: null,
      index: true,
    },
    confirmedCategory: {
      type: String,
      default: null,
      index: true,
    },
    targetOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    adminNote: { type: String, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    reviewedAt: { type: Date, default: null, index: true },
    creatorDecision: {
      type: {
        type: String,
        enum: ["refund", "revoke_creator", "refund_revoke_creator"],
        default: null,
      },
      note: {
        type: String,
        default: null,
      },
      appliedAt: {
        type: Date,
        default: null,
      },
      appliedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
    },
  },
  {
    timestamps: true,
    collection: "reports",
  }
);

// ✅ index anti-duplicati (per context + reason)
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1, contextType: 1, contextId: 1, reasonCode: 1 },
  { unique: true }
);

ReportSchema.index({ status: 1, source: 1, priorityScore: 1, createdAt: -1 });

module.exports = mongoose.model("Report", ReportSchema);

