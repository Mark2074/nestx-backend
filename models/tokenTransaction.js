// models/tokenTransaction.js
const mongoose = require("mongoose");

const TokenTransactionSchema = new mongoose.Schema(
  {
    // Idempotency op (stessa richiesta = stesso opId)
    opId: { type: String, required: true, index: true },
    // Gruppo contabile: collega più righe della stessa operazione (debit+credit)
    groupId: { type: String, required: true, index: true },

    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    kind: {
      type: String,
      enum: [
        "purchase",
        "vip_purchase",
        "transfer",
        "private_purchase",
        "private_release",
        "ticket_purchase",
        "ticket_refund",
        "tip",
        "donation",
        "adv_purchase",
        "showcase_purchase",
        "showcase_hold",
        "showcase_charge",
        "showcase_release",
        "payout",
      ],
      required: true,
    },

    direction: { type: String, enum: ["credit", "debit"], required: true },

    context: {
      type: String,
      enum: ["system", "tip", "donation", "cam", "content", "ticket", "adv", "showcase", "other"],
      default: "other",
    },

    // liveId / profileId / advId / showcaseId / eventId ecc.
    contextId: { type: mongoose.Schema.Types.Mixed, default: null },

    amountTokens: { type: Number, required: true, min: 0 },
    amountEuro: { type: Number, default: 0, min: 0 },

    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
    scope: { type: String, enum: ["public", "private"], default: null },
    roomId: { type: String, default: null },

    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);

// ===== INDICI HARD =====

// Idempotency: impedisce duplicati della STESSA riga.
// (TIP ha 2 righe: debit+credit → direction diverso → ok)
TokenTransactionSchema.index(
  { opId: 1, direction: 1, fromUserId: 1, toUserId: 1, kind: 1 },
  { unique: true }
);

// history
TokenTransactionSchema.index({ fromUserId: 1, createdAt: -1 });
TokenTransactionSchema.index({ toUserId: 1, createdAt: -1 });

// pair caps: daily/monthly outgoing totals for tips/donations
TokenTransactionSchema.index({
  fromUserId: 1,
  toUserId: 1,
  direction: 1,
  context: 1,
  createdAt: -1,
});

// per audit/filtri
TokenTransactionSchema.index({ kind: 1, createdAt: -1 });
TokenTransactionSchema.index({ context: 1, contextId: 1, createdAt: -1 });
TokenTransactionSchema.index({ eventId: 1, createdAt: -1 });

module.exports = mongoose.model("TokenTransaction", TokenTransactionSchema);

