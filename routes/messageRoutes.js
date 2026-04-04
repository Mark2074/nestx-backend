// routes/messageRoutes.js
const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const User = require("../models/user");
const Message = require("../models/message");
const MessageDailyCounter = require("../models/MessageDailyCounter");
const { isUserBlockedEitherSide } = require("../utils/blockUtils");
const Follow = require("../models/Follow");
const { detectContentSafety } = require("../utils/contentSafety");

/**
 * Utils
 */
function getAccountTypeFromUser(user) {
  // già definito altrove? se sì, usa quello comune
  return user.accountType || "base"; // "base", "vip", "creator"
}

function getDailyLimitFromUser(user) {
  // VIP è uno status booleano (isVip), come da concept attuale
  return user && user.isVip === true ? 100 : 10;
}

function getRomeDayKey(date = new Date()) {
  // "en-CA" restituisce YYYY-MM-DD. Timezone coerente con Europe/Rome.
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });
}

const DM_RATE_LIMIT_MS = 3 * 1000;
const lastDmAt = new Map(); // key: senderId -> timestamp

function canSendDirectMessage(userId) {
  const key = String(userId);
  const now = Date.now();
  const last = lastDmAt.get(key) || 0;

  if (now - last < DM_RATE_LIMIT_MS) {
    return {
      ok: false,
      retryAfterMs: DM_RATE_LIMIT_MS - (now - last),
    };
  }

  lastDmAt.set(key, now);
  return { ok: true, retryAfterMs: 0 };
}

/**
 * Verifica se il sender (creator) può iniziare una conversazione con recipient
 * Regole:
 * - se sender NON è creator -> ok
 * - se sender è creator:
 *    - se recipient è creator -> ok
 *    - se recipient segue sender -> ok
 *    - altrimenti -> NO (non può iniziare)
 */
async function canCreatorStartConversation(sender, recipientId) {
  if (sender.isCreator !== true) return true;

  const recipient = await User.findById(recipientId).select("isCreator").lean().exec();
  if (!recipient) return false;

  // creator -> creator sempre ok
  if (recipient.isCreator === true) return true;

  // recipient deve seguire il creator (accepted)
  const rel = await Follow.findOne({
    followerId: recipientId,
    followingId: sender._id,
    status: "accepted",
  }).select("_id").lean().exec();

  return !!rel;
}

/**
 * @route   POST /api/messages/:recipientId
 * @desc    Invia un nuovo messaggio privato
 * @access  Private
 */
router.post("/:recipientId", auth, async (req, res) => {
  try {
    const sender = req.user;
    const recipientId = req.params.recipientId;
    const rawText = req.body?.text;
    const text = String(rawText || "").trim();

    if (!sender) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    if (!recipientId) {
      return res.status(400).json({
        status: "error",
        message: "Recipient ID missing",
      });
    }

    if (!text) {
      return res.status(400).json({
        status: "error",
        message: "The message cannot be empty",
      });
    }

    const dmRl = canSendDirectMessage(sender._id);
    if (!dmRl.ok) {
      return res.status(429).json({
        status: "error",
        code: "DM_RATE_LIMIT",
        message: "You are sending messages too fast",
        retryAfterMs: dmRl.retryAfterMs,
      });
    }

    const check = detectContentSafety(text, "dm");
    if (check.blocked) {
      return res.status(400).json({
        status: "error",
        code: check.code,
        message: "External links are not allowed. You can share email or phone number instead.",
      });
    }

    if (sender._id.toString() === recipientId.toString()) {
      return res.status(400).json({
        status: "error",
        message: "You cannot send a message to yourself",
      });
    }

    const dbSender = await User.findById(sender._id).exec();
    const dbRecipient = await User.findById(recipientId).exec();

    if (!dbRecipient) {
      return res.status(404).json({
        status: "error",
        message: "Recipient not found",
      });
    }

    // ✅ Controllo blocco reciproco (fonte unica: collection Block)
    const isBlocked = await isUserBlockedEitherSide(dbSender._id, dbRecipient._id);
    if (isBlocked) {
      return res.status(403).json({
        status: "error",
        message: "You cannot send messages: a block is active between you",
      });
    }

    const isSenderCreator = dbSender.isCreator === true;

    // Controllo regole creator -> primo messaggio
    // Per capire se è il primo messaggio, cerchiamo se esiste già una conversazione
    const conversationKey = Message.buildConversationKey(
      sender._id,
      dbRecipient._id
    );

    const existingMessage = await Message.findOne({
      conversationKey,
    })
      .select("_id senderId")
      .sort({ createdAt: 1 })
      .exec();

    if (!existingMessage && isSenderCreator) {
      // Primo messaggio di questa conversazione e sender è creator:
      // deve rispettare le regole (non può iniziare se non è seguito)
      const allowed = await canCreatorStartConversation(dbSender, dbRecipient._id);
      if (!allowed) {
        return res.status(403).json({
          status: "error",
          message:
            "As a host, you cannot start a new conversation with users who do not follow you",
        });
      }
    }

    // ✅ Limite giornaliero messaggi (concept attuale: Base 10, VIP 100)
    const dayKey = getRomeDayKey();
    const dailyLimit = getDailyLimitFromUser(dbSender);

    // Incremento atomico del contatore del giorno
    let counterDoc;
    try {
      counterDoc = await MessageDailyCounter.findOneAndUpdate(
        { userId: dbSender._id, dayKey },
        { $inc: { count: 1 } },
        { new: true, upsert: true }
      ).exec();
    } catch (e) {
      // Gestione edge-case race su indice unico (riprova 1 volta)
      counterDoc = await MessageDailyCounter.findOneAndUpdate(
        { userId: dbSender._id, dayKey },
        { $inc: { count: 1 } },
        { new: true }
      ).exec();
    }

    if (counterDoc.count > dailyLimit) {
      // rollback del contatore (best-effort)
      await MessageDailyCounter.updateOne(
        { userId: dbSender._id, dayKey },
        { $inc: { count: -1 } }
      ).exec();

      return res.status(403).json({
        status: "error",
        message: `Daily message limit reached (${dailyLimit}/day)`,
      });
    }

    const newMessage = new Message({
      senderId: sender._id,
      recipientId: dbRecipient._id,
      conversationKey,
      text,
      hasAttachments: false,
    });

    await newMessage.save();

    return res.status(201).json({
      status: "success",
      message: "Message sent",
      data: {
        messageId: newMessage._id,
        conversationKey: newMessage.conversationKey,
        senderId: newMessage.senderId,
        recipientId: newMessage.recipientId,
        text: newMessage.text,
        createdAt: newMessage.createdAt,
      },
    });
  } catch (err) {
    console.error("Errore invio messaggio:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while sending the message",
    });
  }
});

/**
 * @route   GET /api/messages/conversations
 * @desc    Lista conversazioni dell'utente (ultima risposta per ciascuna)
 * @access  Private
 */
router.get("/conversations", auth, async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "User not authenticated",
      });
    }

    const userId = user._id;

    // Recuperiamo tutte le conversazioni dove l'utente è coinvolto
    const messages = await Message.find({
      $or: [{ senderId: userId }, { recipientId: userId }],
      deletedForEveryoneAt: null,
    })
      .sort({ createdAt: -1 })
      .limit(200) // limite di sicurezza
      .exec();

    const lastByConversation = new Map();

    for (const msg of messages) {
      if (!lastByConversation.has(msg.conversationKey)) {
        lastByConversation.set(msg.conversationKey, msg);
      }
    }

    const conversations = Array.from(lastByConversation.values()).map((msg) => ({
      conversationKey: msg.conversationKey,
      lastMessage: {
        id: msg._id,
        senderId: msg.senderId,
        recipientId: msg.recipientId,
        text: msg.text,
        createdAt: msg.createdAt,
        readAt: msg.readAt,
      },
    }));

    return res.status(200).json({
      status: "success",
      message: "Conversations list retrieved",
      data: conversations,
    });
  } catch (err) {
    console.error("Errore recupero conversazioni:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while retrieving conversations",
    });
  }
});

/**
 * @route   GET /api/messages/conversation/:otherUserId
 * @desc    Recupera tutti i messaggi tra me e un altro utente (paginabile in futuro)
 * @access  Private
 */
router.get("/conversation/:otherUserId", auth, async (req, res) => {
  try {
    const user = req.user;
    const otherUserId = req.params.otherUserId;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "User not authenticated",
      });
    }

    if (!otherUserId) {
      return res.status(400).json({
        status: "error",
        message: "Recipient ID missing",
      });
    }

    const conversationKey = Message.buildConversationKey(
      user._id,
      otherUserId
    );

    // ✅ Auto-mark read: segna come letti tutti i messaggi ricevuti da me in questa conversazione
    await Message.updateMany(
      {
        conversationKey,
        recipientId: user._id,
        readAt: null,
        deletedForEveryoneAt: null,
      },
      { $set: { readAt: new Date() } }
    ).exec();

    const messages = await Message.find({
      conversationKey,
      deletedForEveryoneAt: null,
    })
      .sort({ createdAt: 1 })
      .exec();

    return res.status(200).json({
      status: "success",
      message: "Messages of the conversation retrieved",
      data: messages,
    });
  } catch (err) {
    console.error("Errore recupero conversazione:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while retrieving the conversation",
    });
  }
});

/**
 * @route   DELETE /api/messages/:messageId
 * @desc    VIP: elimina un messaggio "per entrambi" (solo UI). Il record resta in DB.
 * @access  Private
 */
router.delete("/:messageId", auth, async (req, res) => {
  try {
    const user = req.user;
    const { messageId } = req.params;

    if (!user) {
      return res.status(401).json({ status: "error", message: "User not authenticated" });
    }

    // ✅ Solo VIP possono eliminare messaggi (policy attuale)
    if (user.isVip !== true) {
      return res.status(403).json({
        status: "error",
        message: "Only VIP users can delete messages",
      });
    }

    if (!messageId) {
      return res.status(400).json({ status: "error", message: "messageId missing" });
    }

    const msg = await Message.findById(messageId).exec();
    if (!msg) {
      return res.status(404).json({ status: "error", message: "Message not found" });
    }

    const meId = user._id.toString();
    const isParticipant =
      msg.senderId.toString() === meId || msg.recipientId.toString() === meId;

    if (!isParticipant) {
      return res.status(403).json({
        status: "error",
        message: "You can't delete messages from conversations you're not in.",
      });
    }

    // Se già eliminato per tutti, risposta idempotente
    if (msg.deletedForEveryoneAt) {
      return res.status(200).json({
        status: "success",
        message: "Message already deleted (UI)",
        data: { messageId: msg._id, deletedForEveryoneAt: msg.deletedForEveryoneAt },
      });
    }

    msg.deletedForEveryoneAt = new Date();

    // (opzionale: segniamo anche i flag vecchi per coerenza futura)
    msg.isDeletedForSender = true;
    msg.isDeletedForRecipient = true;

    await msg.save();

    return res.status(200).json({
      status: "success",
      message: "Message deleted for both (UI only)",
      data: { messageId: msg._id, deletedForEveryoneAt: msg.deletedForEveryoneAt },
    });
  } catch (err) {
    console.error("Errore delete messaggio:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while deleting the message",
    });
  }
});

module.exports = router;
