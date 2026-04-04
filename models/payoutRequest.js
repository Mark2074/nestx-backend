// models/payoutRequest.js
const mongoose = require("mongoose");

const PayoutRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    amountTokens: { type: Number, required: true, min: 1 },

    // payout lifecycle
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "paid"],
      default: "pending",
      index: true,
    },

    // provider info (stub)
    provider: { type: String, enum: ["none", "stripe"], default: "none" },
    providerTransferId: { type: String, default: null },

    // admin review
    reviewedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    adminNote: { type: String, default: null },
    // audit trail (chi ha fatto cosa e quando)
    audit: {
      type: [
        {
          action: { type: String, enum: ["request", "approve", "reject", "mark_paid"], required: true },
          byAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          at: { type: Date, default: Date.now },
          note: { type: String, default: null },
          providerTransferId: { type: String, default: null },
        },
      ],
      default: [],
    },

    requestedAt: { type: Date, default: Date.now, index: true },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
  },
  { versionKey: false }
);

// Indici utili
PayoutRequestSchema.index({ userId: 1, status: 1 });
PayoutRequestSchema.index({ status: 1, requestedAt: -1 });

module.exports = mongoose.model("PayoutRequest", PayoutRequestSchema);
