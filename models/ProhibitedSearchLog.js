const mongoose = require("mongoose");

const ProhibitedSearchLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // hash della query normalizzata (NO chiaro)
    qHash: { type: String, required: true, index: true },

    // lunghezza query per debug senza contenuto
    qLen: { type: Number, default: 0, min: 0 },

    // snapshot minimale: pattern/categoria/severity che ha matchato (no query)
    matchedPatternSnapshot: {
      pattern: { type: String, default: null },
      matchType: { type: String, enum: ["plain", "regex"], default: null },
      severity: { type: String, enum: ["grave", "gravissimo"], default: null },
      category: { type: String, default: null },
    },

    createdAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "prohibited_search_logs", versionKey: false }
);

ProhibitedSearchLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("ProhibitedSearchLog", ProhibitedSearchLogSchema);
