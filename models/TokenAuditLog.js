const mongoose = require("mongoose");

const TokenAuditLogSchema = new mongoose.Schema(
  {
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    actionType: {
      type: String,
      enum: ["TOKEN_DONATION", "TOKEN_TIP", "TOKEN_TRANSFER"],
      required: true,
      index: true,
    },

    amountTokens: { type: Number, required: true, min: 1 },

    opId: { type: String, required: true, index: true },
    groupId: { type: String, required: true, index: true },

    meta: { type: Object, default: {} },

    createdAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "token_audit_logs" }
);

TokenAuditLogSchema.index({ actorUserId: 1, createdAt: -1 });
TokenAuditLogSchema.index({ targetUserId: 1, createdAt: -1 });

module.exports = mongoose.model("TokenAuditLog", TokenAuditLogSchema);
