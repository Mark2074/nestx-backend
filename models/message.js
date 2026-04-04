// models/message.js
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // per conversazioni 1-1, possiamo usare una chiave derivata (ordinata)
    conversationKey: {
      type: String,
      index: true,
      required: true,
    },
    text: {
      type: String,
      trim: true,
      default: "",
    },
    // in futuro possiamo aggiungere allegati, ecc.
    hasAttachments: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
    // Soft delete (UI): VIP può eliminare "per entrambi"
    deletedForEveryoneAt: {
      type: Date,
      default: null,
    },

    // (lasciamo questi per futuro "cancella per me" o compatibilità)
    isDeletedForSender: {
      type: Boolean,
      default: false,
    },
    isDeletedForRecipient: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// helper per generare una key coerente dato due userId
messageSchema.statics.buildConversationKey = function (userId1, userId2) {
  const a = userId1.toString();
  const b = userId2.toString();
  return a < b ? `${a}__${b}` : `${b}__${a}`;
};

module.exports = mongoose.model("Message", messageSchema);
