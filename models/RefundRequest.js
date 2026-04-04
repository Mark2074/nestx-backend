const mongoose = require("mongoose");

const RefundRequestSchema = new mongoose.Schema(
  {
    requesterUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    amountTokens: { type: Number, required: true, min: 1 },

    reasonText: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },

    referenceType: {
      type: String,
      enum: ["event", "ticket", "payment", "post", "other"],
      required: true,
    },
    referenceId: { type: String, required: true, trim: true },

    attachments: { type: [String], default: [] },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "refunded"],
      default: "pending",
      index: true,
    },

    adminNote: { type: String, default: null },

    decidedAt: { type: Date, default: null },
    decidedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    refundedAt: { type: Date, default: null },

    refundLogId: { type: mongoose.Schema.Types.ObjectId, ref: "RefundLog", default: null },
  },
  { timestamps: true }
);

RefundRequestSchema.index({ requesterUserId: 1, createdAt: -1 });
RefundRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("RefundRequest", RefundRequestSchema);
