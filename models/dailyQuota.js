// models/dailyQuota.js
const mongoose = require("mongoose");

const dailyQuotaSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    dayKey: { type: String, required: true, index: true }, // YYYY-MM-DD UTC

    advFreeUsed: { type: Number, default: 0, min: 0 },
    advPaidUsed: { type: Number, default: 0, min: 0 },

    showcaseFreeUsed: { type: Number, default: 0, min: 0 },
    showcasePaidUsed: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false }
);

dailyQuotaSchema.index({ userId: 1, dayKey: 1 }, { unique: true });

module.exports = mongoose.model("DailyQuota", dailyQuotaSchema);
