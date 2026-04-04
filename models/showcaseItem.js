const mongoose = require("mongoose");

const showcaseSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    opId: { type: String, required: true }, // idempotenza creazione
    chargedGroupId: { type: String, default: null, index: true }, // groupId ledger (solo se paid)


    // finestra validità (7 giorni)
    startsAt: { type: Date, default: null, index: true },
    endsAt: { type: Date, default: null, index: true },

    // contenuto vetrina
    title: { type: String, required: true, trim: true },
    text: { type: String, trim: true, default: "" },
    mediaUrl: { type: String, trim: true, default: "" },

    isActive: { type: Boolean, default: true, index: true },

    languages: [{ type: String, trim: true, lowercase: true }],
    countries: [{ type: String, trim: true, uppercase: true }],

    // monetizzazione (paid scatta oltre 2 slot free; pagamento SOLO in approve)
    billingType: {
      type: String,
      enum: ["free", "paid"],
      default: "free",
      index: true,
    },
    paidTokens: { type: Number, default: 0 },

    holdTokens: {
      type: Number,
      default: 0,
    },

    holdStatus: {
      type: String,
      enum: ["none", "held", "charged", "released"],
      default: "none",
    },

    // MODERAZIONE
    reviewStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: null },

    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

showcaseSchema.index({ opId: 1 }, { unique: true });
showcaseSchema.index({ reviewStatus: 1, createdAt: -1 });
showcaseSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model("ShowcaseItem", showcaseSchema);

