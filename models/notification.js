// models/notification.js
const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    // destinatario della notifica
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },

    // chi ha generato l'azione (può essere null per system)
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // tipo notifica (minimo per partire)
    type: {
      type: String,
      enum: [
        // SOCIAL
        "SOCIAL_FOLLOW_REQUEST",
        "SOCIAL_FOLLOW_ACCEPTED",
        "SOCIAL_FOLLOW_REJECTED",
        "SOCIAL_NEW_FOLLOWER",
        "SOCIAL_POST_LIKED",
        "SOCIAL_POST_COMMENTED",

        // EVENTI
        "EVENT_WENT_LIVE",
        "EVENT_CANCELLED",
        "EVENT_FINISHED",
        "EVENT_PRIVATE_STARTED",

        // TOKEN / PAGAMENTI
        "TOKEN_RECEIVED",
        "TICKET_PURCHASED",
        "TICKET_REFUNDED",

        // MANUAL REFUNDS (admin queue)
        "MANUAL_REFUND_APPROVED",
        "MANUAL_REFUND_REJECTED",

        // SISTEMA (già pronti, li useremo dopo)
        "SYSTEM_PROFILE_VERIFICATION_APPROVED",
        "SYSTEM_PROFILE_VERIFICATION_REJECTED",
        "SYSTEM_TOTEM_VERIFICATION_APPROVED",
        "SYSTEM_TOTEM_VERIFICATION_REJECTED",
        "SYSTEM_VIP_CHANGED",

        // ADV
        "ADV_APPROVED",
        "ADV_REJECTED",

        // VETRINA
        "VETRINA_APPROVED",
        "VETRINA_REJECTED",

        "ADMIN_ADV_PENDING",
        "ADMIN_VETRINA_PENDING",
        "ADMIN_REPORT_PENDING",

        "ADMIN_PROFILE_VERIFICATION_PENDING",
        "ADMIN_TOTEM_VERIFICATION_PENDING",

        "ADMIN_CREATOR_VERIFICATION_PENDING",
        "SYSTEM_CREATOR_VERIFICATION_APPROVED",
        "SYSTEM_CREATOR_VERIFICATION_REJECTED",

        "SYSTEM_PRIVATE_FUNDS_FROZEN",
        "SYSTEM_PRIVATE_FUNDS_REFUNDED",
        "SYSTEM_PRIVATE_FUNDS_RELEASED",
        "SYSTEM_CREATOR_DISABLED",
        "SYSTEM_CREATOR_REENABLED",
      ],
      required: true,
      index: true,
    },

    // target (post/event/user ecc.)
    targetType: {
      type: String,
      enum: ["user", "post", "event", "ticket", "token_tx", "adv", "showcase", "report", "system"],
      default: "system",
      index: true,
    },
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    // testo pronto da UI (semplice)
    message: { type: String, default: "" },

    // extra info (es: preview testo commento, amount token, ecc.)
    data: { type: Object, default: {} },

    // stato lettura
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },

    // persistenza: token/pagamenti devono restare
    isPersistent: { type: Boolean, default: false, index: true },

    // anti-spam: chiave di deduplica (unica, sparse)
    dedupeKey: { type: String, default: undefined  },
  },
  { timestamps: true }
);

// dedupe (una notifica per dedupeKey)
NotificationSchema.index(
  { dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: "string" } }
  }
);

// query veloci per inbox
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", NotificationSchema);
