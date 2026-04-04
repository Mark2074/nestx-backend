const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const Adv = require("../models/adv");
const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");
const Notification = require("../models/notification");
const ShowcaseItem = require("../models/showcaseItem");
const adminGuard = require("../middleware/adminGuard");

function activeWindowQuery(now = new Date()) {
  return {
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  };
}

// GET /api/admin/adv/pending
router.get("/adv/pending", auth, adminGuard, async (req, res) => {
  try {
    const list = await Adv.find({ reviewStatus: "pending" })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ status: "ok", count: list.length, data: list });
  } catch (e) {
    console.error("admin adv pending error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

router.patch("/adv/:id/approve", auth, adminGuard, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;
    const adminNote = (req.body?.note || "").toString().trim() || null;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: "error", message: "invalid advId" });
    }

    const adv = await Adv.findById(id);
    if (!adv) return res.status(404).json({ status: "error", message: "ADV not found" });
    // approvo solo se pending
    if (adv.reviewStatus !== "pending") {
      return res.status(409).json({ status: "error", message: "ADV not in pending state" });
    }

    const now = new Date();

    // ✅ Regola: max 1 ADV attiva (approved) per creator per placement
    const existingActive = await Adv.findOne({
      _id: { $ne: adv._id },
      creatorId: adv.creatorId,
      placement: adv.placement,
      isActive: true,
      reviewStatus: "approved",
      ...activeWindowQuery(now),
    }).select("_id");

    if (existingActive) {
      // respingo questa ADV perché placement già occupato
      adv.reviewStatus = "rejected";
      adv.reviewedBy = req.user._id;
      adv.reviewedAt = now;
      adv.reviewNote = adminNote
        ? `Placement già occupato (max 1 ADV attiva per placement). Nota: ${adminNote}`
        : "Placement già occupato (max 1 ADV attiva per placement).";
      await adv.save();

      // 🔔 notifica utente (rejected) — dedupe safe
      try {
        await Notification.create({
          userId: adv.creatorId,
          actorId: req.user._id,
          type: "ADV_REJECTED",
          targetType: "system",
          targetId: adv._id,
          message: "ADV rejected: placement limit (you can only have 1 active ADV per placement).",
          data: {
            advId: String(adv._id),
            reason: "PLACEMENT_LIMIT",
            placement: adv.placement,
            note: adv.reviewNote,
          },
          isPersistent: false,
          dedupeKey: `adv:${adv._id}:rejected`,
        });
      } catch (e) {
        if (e?.code !== 11000) throw e;
      }

      // 🧹 chiudi notifica admin ADV pending (queue)
      await Notification.updateMany(
        {
          userId: null,
          isRead: false,
          type: "ADMIN_ADV_PENDING",
          targetType: "adv",
          targetId: adv._id,
          dedupeKey: `admin:adv:${adv._id}:pending`,
        },
        { $set: { isRead: true, readAt: new Date() } }
      );

      return res.status(409).json({
        status: "error",
        code: "PLACEMENT_LIMIT",
        message: "Rejected: there is already an active ADV in this placement for the same creator.",
        data: adv,
      });
    }

    // ✅ Pagamento SOLO qui, SOLO se billingType=paid
    await session.withTransaction(async () => {
      // ricarico adv dentro session per evitare race (soprattutto su token)
      const advTx = await Adv.findById(id).session(session);
      if (!advTx) {
        const err = new Error("ADV not found");
        err.statusCode = 404;
        throw err;
      }
      if (advTx.reviewStatus !== "pending") {
        const err = new Error("ADV not in pending state");
        err.statusCode = 409;
        throw err;
      }

      // ✅ Pagamento SOLO qui, SOLO se billingType=paid
      if (advTx.billingType === "paid" && (advTx.paidTokens || 0) > 0) {
        const price = Number(advTx.paidTokens) || 0;

        const userTx = await User.findById(advTx.creatorId).select("tokenBalance").session(session);
        const bal = userTx?.tokenBalance || 0;

        if (!userTx || bal < price) {
          advTx.reviewStatus = "rejected";
          advTx.reviewedBy = req.user._id;
          advTx.reviewedAt = now;
          advTx.reviewNote = adminNote ? `Fondi insufficienti. Nota: ${adminNote}` : "Fondi insufficienti.";
          await advTx.save({ session });

          const err = new Error(`Fondi insufficienti (servono ${price} token al momento dell’approvazione).`);
          err.statusCode = 409;
          err.code = "INSUFFICIENT_FUNDS";
          err.data = advTx;
          throw err;
        }

        // scala token
        userTx.tokenBalance = bal - price;
        await userTx.save({ session });

        // traccia transazione (kind coerente)
        await TokenTransaction.create([{
          fromUserId: advTx.creatorId,
          toUserId: null,
          kind: "purchase",
          direction: "debit",
          context: "other",
          amountTokens: price,
          amountEuro: 0,
          metadata: {
            reason: "adv_approval",
            advId: String(advTx._id),
            placement: advTx.placement,
          },
        }], { session });
      }

      // APPROVA
      advTx.reviewStatus = "approved";
      advTx.reviewedBy = req.user._id;
      advTx.reviewedAt = now;
      advTx.reviewNote = adminNote || null;
      await advTx.save({ session });

      // riallineo variabile esterna per response e notifiche
      adv.reviewStatus = advTx.reviewStatus;
      adv.reviewedBy = advTx.reviewedBy;
      adv.reviewedAt = advTx.reviewedAt;
      adv.reviewNote = advTx.reviewNote;
    });

    // 🔔 notifica utente (approved) — dedupe safe
    try {
      await Notification.create({
        userId: adv.creatorId,
        actorId: req.user._id,
        type: "ADV_APPROVED",
        targetType: "system",
        targetId: adv._id,
        message: "ADV approved.",
        data: {
          advId: String(adv._id),
          placement: adv.placement,
          billingType: adv.billingType,
          paidTokens: adv.paidTokens || 0,
        },
        isPersistent: false,
        dedupeKey: `adv:${adv._id}:approved`,
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }

    // 🧹 chiudi notifica admin ADV pending (queue)
    await Notification.updateMany(
      {
        userId: null,
        isRead: false,
        type: "ADMIN_ADV_PENDING",
        targetType: "adv",
        targetId: adv._id,
        dedupeKey: `admin:adv:${adv._id}:pending`,
      },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.json({ status: "ok", data: adv });
  } catch (e) {
    console.error("admin adv approve error:", e);

    // gestione errori “con statusCode” lanciati dalla transaction
    if (e?.statusCode) {
      return res.status(e.statusCode).json({
        status: e.statusCode === 409 ? "error" : "error",
        code: e.code || undefined,
        message: e.message || "Error",
        data: e.data || undefined,
      });
    }

    return res.status(500).json({ status: "error", message: "Internal error" });
  } finally {
    session.endSession();
  }
});

router.patch("/adv/:id/reject", auth, adminGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const adminNote = (req.body?.note || "").toString().trim() || null;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: "error", message: "Invalid advId" });
    }

    const adv = await Adv.findById(id);
    if (!adv) {
      return res.status(404).json({ status: "error", message: "ADV not found" });
    }

    // rifiuto solo se pending
    if (adv.reviewStatus !== "pending") {
      return res.status(409).json({ status: "error", message: "ADV not in pending state" });
    }

    const now = new Date();

    adv.reviewStatus = "rejected";
    adv.reviewedBy = req.user._id;
    adv.reviewedAt = now;
    adv.reviewNote = adminNote || "Rifiutato dall’amministrazione.";
    await adv.save();

    // 🔔 notifica utente (rejected) — dedupe safe
    try {
      await Notification.create({
        userId: adv.creatorId,
        actorId: req.user._id,
        type: "ADV_REJECTED",
        targetType: "system",
        targetId: adv._id,
        message: "ADV rifiutato dall’amministrazione.",
        data: {
          advId: String(adv._id),
          reason: "ADMIN_REJECT",
          note: adv.reviewNote,
        },
        isPersistent: false,
        dedupeKey: `adv:${adv._id}:rejected`,
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }

    // 🧹 chiudi notifica admin ADV pending (queue)
    await Notification.updateMany(
      {
        userId: null,
        isRead: false,
        type: "ADMIN_ADV_PENDING",
        targetType: "adv",
        targetId: adv._id,
        dedupeKey: `admin:adv:${adv._id}:pending`,
      },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.json({ status: "ok", data: adv });
  } catch (e) {
    console.error("admin adv reject error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
