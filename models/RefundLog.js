const mongoose = require("mongoose");

const RefundLogSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["auto_refund", "manual_refund"], required: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    amountTokens: { type: Number, required: true, min: 1 },

    currency: { type: String, enum: ["token"], default: "token" },

    reasonCode: {
      type: String,
      enum: [
        "EVENT_CANCELLED",
        "CREATOR_NO_SHOW",
        "PAYMENT_ERROR",
        "DUPLICATE_CHARGE",
        "SYSTEM_FAILURE",
        "MANUAL_APPROVED",
      ],
      required: true,
    },

    referenceType: { type: String, enum: ["event", "ticket", "payment", "post", "other"], required: true },
    referenceId: { type: String, required: true },

    createdByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    resolved: { type: Boolean, default: true },
  },
  { timestamps: true }
);

RefundLogSchema.index({ reasonCode: 1, createdAt: -1 });
RefundLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("RefundLog", RefundLogSchema);
