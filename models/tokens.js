// models/tokens.js
// NOTE: this file exists only to avoid accidental imports breaking the app.
// Real ledger models are in:
// - models/tokenTransaction.js
// - user token fields (tokenBalance / tokenEarnings / tokenRedeemable)

const mongoose = require("mongoose");

const TokensSchema = new mongoose.Schema(
  {
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Tokens || mongoose.model("Tokens", TokensSchema);