const mongoose = require("mongoose");

const ActionAuditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorRole: { type: String, default: "user", index: true }, // "user" | "admin" (string semplice)

    actionType: { type: String, required: true, index: true }, // "POST_DELETE"
    targetType: { type: String, required: true, index: true }, // "post"
    targetId: { type: String, required: true, index: true },   // postId string

    reason: { type: String, default: null }, // "user_delete" | "admin_action"
    meta: { type: Object, default: {} },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },

    createdAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "action_audit_logs" }
);

ActionAuditLogSchema.index({ actorId: 1, createdAt: -1 });
ActionAuditLogSchema.index({ actionType: 1, createdAt: -1 });

module.exports = mongoose.model("ActionAuditLog", ActionAuditLogSchema);
