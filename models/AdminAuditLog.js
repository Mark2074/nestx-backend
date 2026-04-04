const mongoose = require("mongoose");

const AdminAuditLogSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },

    actionType: {
      type: String,
      enum: [
        "REVIEW_REPORT",
        "ACTION_REPORT",
        "DISMISS_REPORT",
        "HIDE_REPORT",
        "REOPEN_REPORT",
        "DICT_ADD",
        "DICT_UPDATE",
        "DICT_DELETE",
        "SEARCH_BLOCKED",
        "VIEW_REPORTED_DM",
        "POST_DELETE",
        "TOKEN_DONATION",
        "TOKEN_TIP",
        "TOKEN_TRANSFER",
        "ADMIN_LOGIN",
        "ADMIN_CREATOR_DECISION",
        "ADMIN_SHOWCASE_DECISION",
        "ADMIN_USER_ENFORCEMENT",
        "HIDE_POST",
        "UNHIDE_POST",
        "USER_MODERATION",
        "AI_HIDE_POST",
        "AI_UNHIDE_POST",
        "AI_HIDE_COMMENT",
        "AI_HIDE_LIVE_MESSAGE",
        "ADMIN_PRIVATE_FUNDS_FROZEN",
        "ADMIN_PRIVATE_FUNDS_REFUNDED",
        "ADMIN_CREATOR_DISABLED",
      ],
      required: true,
      index: true,
    },

    targetType: {
      type: String,
      enum: ["user", "post", "event", "report", "dm", "dictionary", "search", "showcase",
            "system", "comment", "live_message",],
      required: true,
      index: true,
    },

    targetId: { type: String, default: null, index: true },

    meta: { type: Object, default: {} },

    createdAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "admin_audit_logs" }
);

AdminAuditLogSchema.index({ adminId: 1, createdAt: -1 });
AdminAuditLogSchema.index({ actionType: 1, createdAt: -1 });

module.exports = mongoose.model("AdminAuditLog", AdminAuditLogSchema);
