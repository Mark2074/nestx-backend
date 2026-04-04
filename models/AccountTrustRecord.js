const mongoose = require("mongoose");

const TrustEventSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: [
        "report_actioned",
        "post_hidden",
        "private_funds_frozen",
        "private_funds_refunded",
        "creator_disabled",
        "creator_reenabled",
        "manual_refund_approved",
      ],
      required: true,
    },
    reportId: { type: mongoose.Schema.Types.ObjectId, ref: "Report", default: null },
    targetType: { type: String, enum: ["user", "post", "event"], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    severity: { type: String, enum: ["grave", "gravissimo"], default: null },
    category: { type: String, default: null },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
    note: { type: String, default: null, maxlength: 300 },
    reasonCode: { type: String, default: null, maxlength: 100 },

    reportReason: { type: String, default: null, maxlength: 300 },
    userMessage: { type: String, default: null, maxlength: 500 },
    adminOutcome: { type: String, default: null, maxlength: 100 },
    adminNote: { type: String, default: null, maxlength: 500 },

    at: { type: Date, default: Date.now },
    byAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const AccountTrustRecordSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },

    confirmedTotal: { type: Number, default: 0, min: 0 },
    confirmedGrave: { type: Number, default: 0, min: 0 },
    confirmedGravissimo: { type: Number, default: 0, min: 0 },

    creatorFreezeTotal: { type: Number, default: 0, min: 0 },
    creatorRefundTotal: { type: Number, default: 0, min: 0 },
    creatorDisableTotal: { type: Number, default: 0, min: 0 },
    creatorReenableTotal: { type: Number, default: 0, min: 0 },
    manualRefundApprovedTotal: { type: Number, default: 0, min: 0 },

    tier: { type: String, enum: ["OK", "ATTENZIONE", "CRITICO", "BLOCCO"], default: "OK", index: true },
    tierScore: { type: Number, default: 0, index: true },
    lastConfirmedAt: { type: Date, default: null, index: true },
    lastConfirmedSeverity: { type: String, enum: ["grave", "gravissimo"], default: null },
    lastConfirmedCategory: { type: String, default: null },

    lastCreatorFreezeAt: { type: Date, default: null, index: true },
    lastCreatorRefundAt: { type: Date, default: null, index: true },
    lastCreatorDisableAt: { type: Date, default: null, index: true },
    lastCreatorReenableAt: { type: Date, default: null, index: true },

    creatorFlagged: { type: Boolean, default: false, index: true },
    creatorReviewNote: { type: String, default: null, maxlength: 300 },

    lastEvents: { type: [TrustEventSchema], default: [] },
    prohibitedSearchTotal: { type: Number, default: 0 },
    lastProhibitedSearchAt: { type: Date, default: null },

    updatedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "account_trust_records" }
);

module.exports = mongoose.model("AccountTrustRecord", AccountTrustRecordSchema);
