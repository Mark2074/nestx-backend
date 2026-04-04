const mongoose = require("mongoose");

const advSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    opId: { type: String, required: true }, // idempotenza creazione
    chargedGroupId: { type: String, default: null, index: true }, // groupId ledger (solo se paid)


    // dove porta
    targetType: {
      type: String,
      enum: ["event", "liveRoom", "url"],
      default: "url",
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    // finestra validità ADV (profile/rotazioni)
    startsAt: { type: Date, default: null, index: true },
    endsAt: { type: Date, default: null, index: true },

    title: { type: String, required: true, trim: true },
    text: { type: String, trim: true, default: "" },
    mediaUrl: { type: String, trim: true, default: "" },

    // URL interno alla piattaforma (OBBLIGO: path, no link esterni)
    targetUrl: { type: String, required: true, trim: true },

    placement: {
      type: String,
      enum: ["feed", "pre_event", "profile"],
      default: "profile",
      index: true,
    },

      // per rispettare "neutral feed" (NO HOT)
    contentScope: {
      type: String,
      enum: ["HOT", "NO_HOT"],
      default: "NO_HOT",
      index: true,
    },

    isActive: { type: Boolean, default: true, index: true },

    languages: [{ type: String, trim: true, lowercase: true }],
    countries: [{ type: String, trim: true, uppercase: true }],

    // monetizzazione
    billingType: {
      type: String,
      enum: ["free", "paid"],
      default: "free",
      index: true,
    },
    paidTokens: { type: Number, default: 0 },

    // MODERAZIONE (controllo assoluto)
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

advSchema.index({ opId: 1 }, { unique: true });
advSchema.index({ reviewStatus: 1, createdAt: -1 });
advSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model("Adv", advSchema);
