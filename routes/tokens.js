// routes/tokens.js
const express = require("express");
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const featureGuard = require("../middleware/featureGuard");
const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");
const Notification = require("../models/notification");
const AdminAuditLog = require("../models/AdminAuditLog");
const TokenAuditLog = require("../models/TokenAuditLog");
const crypto = require("crypto");
const { debitUserTokensBuckets } = require("../services/tokenDebitService");
const Event = require("../models/event");

const router = express.Router();

function isEconomyEnabled() {
  return String(process.env.ECONOMY_ENABLED || "false").toLowerCase() === "true";
}

const DONATION_PAIR_DAILY_CAP = 500;
const DONATION_PAIR_MONTHLY_CAP = 3000;
const TIP_PAIR_DAILY_CAP = 1000;
const TIP_PAIR_MONTHLY_CAP = 6000;

function logTokenFlow(stage, payload = {}) {
  try {
    console.log(
      `[TOKENS][${stage}]`,
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      })
    );
  } catch {
    console.log(`[TOKENS][${stage}]`, payload);
  }
}

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function startOfUtcMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

async function getPairOutgoingTotal({ fromUserId, toUserId, context, since }) {
  const row = await TokenTransaction.aggregate([
    {
      $match: {
        fromUserId: new mongoose.Types.ObjectId(fromUserId),
        toUserId: new mongoose.Types.ObjectId(toUserId),
        direction: "debit",
        context,
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$amountTokens" },
      },
    },
  ]);

  return Number(row?.[0]?.total || 0);
}

function getTokenEuroValue() {
  const raw = process.env.TOKEN_EURO_VALUE;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "tokenBalance tokenPurchased tokenEarnings tokenRedeemable tokenHeld"
    );

    const balance = Number(user?.tokenBalance || 0);
    const purchased = Number(user?.tokenPurchased || 0);
    const earnings = Number(user?.tokenEarnings || 0);
    const redeemable = Number(user?.tokenRedeemable || 0);
    const held = Number(user?.tokenHeld || 0);

    return res.json({
      status: "ok",
      economyEnabled: isEconomyEnabled(),
      balance,
      purchased,
      earnings,
      redeemable,
      held,
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: "Failed to load tokens" });
  }
});

// --- POST /tokens/topup ---
// Ricarica simulata/dev (non è "purchase" interno del concept)
// Ricarica simulata: aggiunge tokenBalance all'utente loggato
// Body: { tokens: number }
router.post("/topup", auth, featureGuard("tokens", { allowAdmin: true }), async (req, res) => {
  const session = await mongoose.startSession();

  try {
    let { tokens } = req.body;

    if (typeof tokens !== "number" || !Number.isInteger(tokens)) {
      return res.status(400).json({
        error: "The field 'tokens' is required and must be an integer.",
      });
    }

    if (tokens <= 0) {
      return res.status(400).json({ error: "The number of tokens must be greater than 0." });
    }

    if (tokens > 1_000_000) {
      return res.status(400).json({ error: "Token demand too high." });
    }

    const amountEuro = tokens * getTokenEuroValue();

    const opIdRaw = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    const opId =
      typeof opIdRaw === "string" && opIdRaw.trim().length >= 8
        ? opIdRaw.trim()
        : `topup_${crypto.randomUUID()}`;

    let updatedUser = null;
    let txDoc = null;

    await session.withTransaction(async () => {
      const existing = await TokenTransaction.findOne({
        opId,
        kind: "purchase",
        direction: "credit",
        toUserId: req.user._id,
      }).session(session);

      if (existing) {
        updatedUser = await User.findById(req.user._id)
          .select("tokenBalance tokenPurchased tokenEarnings tokenRedeemable tokenHeld displayName accountType")
          .session(session);

        txDoc = existing;
        return;
      }

      const groupId = `grp_${crypto.randomUUID()}`;

      updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        {
          $inc: {
            tokenBalance: tokens,
            tokenPurchased: tokens,
          },
        },
        { new: true, session }
      ).select("tokenBalance tokenPurchased tokenEarnings tokenRedeemable tokenHeld displayName accountType");

      if (!updatedUser) {
        const err = new Error("User not found.");
        err.statusCode = 404;
        throw err;
      }

      txDoc = await TokenTransaction.create(
        [
          {
            opId,
            groupId,
            fromUserId: null,
            toUserId: updatedUser._id,
            kind: "purchase",
            direction: "credit",
            context: "system",
            amountTokens: tokens,
            amountEuro,
            metadata: {
              note: "Simulated topup",
            },
          },
        ],
        { session }
      ).then((rows) => rows[0]);

      await Notification.create(
        [
          {
            userId: updatedUser._id,
            actorId: null,
            type: "TOKEN_RECEIVED",
            targetType: "token_tx",
            targetId: txDoc._id,
            message: `Charging complete: +${tokens} token`,
            data: {
              kind: "purchase",
              context: "system",
              amountTokens: tokens,
              amountEuro,
              opId,
              groupId,
            },
            isPersistent: true,
            dedupeKey: `token_tx:${opId}:purchase:received`,
          },
        ],
        { session }
      );
    });

    return res.status(201).json({
      message: "Token top-up completed.",
      tokenBalance: Number(updatedUser?.tokenBalance || 0),
      tokenPurchased: Number(updatedUser?.tokenPurchased || 0),
      amountTokens: tokens,
      amountEuro,
      opId,
    });
  } catch (err) {
    console.error("Errore POST /tokens/topup:", err);
    return res.status(err.statusCode || 500).json({
      status: "error",
      message: err.message || "Internal error while recharging tokens.",
    });
  } finally {
    session.endSession();
  }
});

// --- POST /tokens/transfer ---
// Trasferisce token da utente loggato a un altro utente
// Body: { toUserId: string, amountTokens: number, context?: "tip" | "donation" | "cam" | "content" }
// --- POST /tokens/transfer ---
// Trasferisce token da utente loggato a un altro utente
// Body: { toUserId: string, amountTokens: number, context?: "tip" | "donation" | "cam" | "content" }
router.post("/transfer", auth, featureGuard("tokens"), async (req, res) => {
  const session = await mongoose.startSession();

    try {
    const { toUserId, amountTokens, context, eventId } = req.body;

    logTokenFlow("START", {
      route: "POST /tokens/transfer",
      fromUserId: String(req.user?._id || ""),
      toUserId: String(toUserId || ""),
      amountTokens: Number(amountTokens || 0),
      context: String(context || "").trim() || null,
      eventId: eventId ? String(eventId) : null,
    });

    if (!toUserId || !mongoose.Types.ObjectId.isValid(toUserId)) {
      return res.status(400).json({ error: "Invalid toUserId." });
    }

    const amt = Number(amountTokens);
    if (!Number.isFinite(amt) || !Number.isInteger(amt) || amt <= 0) {
      return res.status(400).json({
        error: "amountTokens is required and must be an integer greater than 0.",
      });
    }

    const fromUserId = req.user._id.toString();
    if (fromUserId === toUserId) {
      return res.status(400).json({ error: "You cannot send tokens to yourself." });
    }

    const allowedContexts = ["tip", "donation", "cam", "content"];
    const safeContext = allowedContexts.includes(String(context || "").trim()) ? String(context).trim() : null;

    if (!safeContext) {
      logTokenFlow("ERROR", {
        route: "POST /tokens/transfer",
        fromUserId: String(fromUserId),
        toUserId: String(toUserId || ""),
        code: "INVALID_TOKEN_CONTEXT",
        context: String(context || "").trim() || null,
      });

      return res.status(400).json({
        status: "error",
        code: "INVALID_TOKEN_CONTEXT",
        message: "Allowed contexts: tip, donation, cam, content",
      });
    }

    // TIP in live requires eventId (we must link tip -> event)
    if (safeContext === "tip") {
      if (!eventId || !mongoose.Types.ObjectId.isValid(String(eventId))) {
        logTokenFlow("ERROR", {
          route: "POST /tokens/transfer",
          fromUserId: String(fromUserId),
          toUserId: String(toUserId || ""),
          code: "EVENT_ID_REQUIRED_FOR_TIP",
          context: "tip",
          eventId: eventId ? String(eventId) : null,
        });

        return res.status(400).json({
          status: "error",
          code: "EVENT_ID_REQUIRED_FOR_TIP",
          message: "eventId is required for tip",
        });
      }
    }

    // kind coerente: tip/donation restano tali, altrimenti transfer
    const kind =
      safeContext === "tip" ? "tip" :
      safeContext === "donation" ? "donation" :
      "transfer";

    const todayStart = startOfUtcDay();
    const monthStart = startOfUtcMonth();

    if (safeContext === "donation") {
      const dayTotal = await getPairOutgoingTotal({
        fromUserId,
        toUserId,
        context: "donation",
        since: todayStart,
      });

      const monthTotal = await getPairOutgoingTotal({
        fromUserId,
        toUserId,
        context: "donation",
        since: monthStart,
      });

      if (dayTotal + amt > DONATION_PAIR_DAILY_CAP) {
        logTokenFlow("ERROR", {
          route: "POST /tokens/transfer",
          fromUserId: String(fromUserId),
          toUserId: String(toUserId),
          code: "DONATION_DAILY_CAP",
          context: "donation",
          amountTokens: amt,
          alreadyUsed: dayTotal,
          cap: DONATION_PAIR_DAILY_CAP,
        });

        return res.status(429).json({
          status: "error",
          code: "DONATION_DAILY_CAP",
          message: "Daily donation cap reached for this recipient.",
          data: { cap: DONATION_PAIR_DAILY_CAP, alreadyUsed: dayTotal },
        });
      }

      if (monthTotal + amt > DONATION_PAIR_MONTHLY_CAP) {
        logTokenFlow("ERROR", {
          route: "POST /tokens/transfer",
          fromUserId: String(fromUserId),
          toUserId: String(toUserId),
          code: "DONATION_MONTHLY_CAP",
          context: "donation",
          amountTokens: amt,
          alreadyUsed: monthTotal,
          cap: DONATION_PAIR_MONTHLY_CAP,
        });

        return res.status(429).json({
          status: "error",
          code: "DONATION_MONTHLY_CAP",
          message: "Monthly donation cap reached for this recipient.",
          data: { cap: DONATION_PAIR_MONTHLY_CAP, alreadyUsed: monthTotal },
        });
      }
    }

    if (safeContext === "tip") {
      const dayTotal = await getPairOutgoingTotal({
        fromUserId,
        toUserId,
        context: "tip",
        since: todayStart,
      });

      const monthTotal = await getPairOutgoingTotal({
        fromUserId,
        toUserId,
        context: "tip",
        since: monthStart,
      });

      if (dayTotal + amt > TIP_PAIR_DAILY_CAP) {
        logTokenFlow("ERROR", {
          route: "POST /tokens/transfer",
          fromUserId: String(fromUserId),
          toUserId: String(toUserId),
          code: "TIP_DAILY_CAP",
          context: "tip",
          amountTokens: amt,
          alreadyUsed: dayTotal,
          cap: TIP_PAIR_DAILY_CAP,
          eventId: eventId ? String(eventId) : null,
        });

        return res.status(429).json({
          status: "error",
          code: "TIP_DAILY_CAP",
          message: "Daily tip cap reached for this recipient.",
          data: { cap: TIP_PAIR_DAILY_CAP, alreadyUsed: dayTotal },
        });
      }

      if (monthTotal + amt > TIP_PAIR_MONTHLY_CAP) {
        logTokenFlow("ERROR", {
          route: "POST /tokens/transfer",
          fromUserId: String(fromUserId),
          toUserId: String(toUserId),
          code: "TIP_MONTHLY_CAP",
          context: "tip",
          amountTokens: amt,
          alreadyUsed: monthTotal,
          cap: TIP_PAIR_MONTHLY_CAP,
          eventId: eventId ? String(eventId) : null,
        });

        return res.status(429).json({
          status: "error",
          code: "TIP_MONTHLY_CAP",
          message: "Monthly tip cap reached for this recipient.",
          data: { cap: TIP_PAIR_MONTHLY_CAP, alreadyUsed: monthTotal },
        });
      }
    }

    // idempotency
    const opIdRaw = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    const opId = (typeof opIdRaw === "string" && opIdRaw.trim().length >= 8)
      ? opIdRaw.trim()
      : `tx_${crypto.randomUUID()}`;

    const groupId = `grp_${crypto.randomUUID()}`;

    let fromUser = null;
    let toUser = null;
    let txDebit = null;
    let txCredit = null;
    let goesToEarnings = false;

    await session.withTransaction(async () => {
      // 0) idempotenza: se abbiamo già registrato il DEBIT per questo op, ritorno idempotente
      const existingDebit = await TokenTransaction.findOne({
        opId,
        kind,
        direction: "debit",
        fromUserId,
        toUserId,
      }).session(session);

      if (existingDebit) {
        // carico utenti per risposta aggiornata
        [fromUser, toUser] = await Promise.all([
          User.findById(fromUserId).session(session),
          User.findById(toUserId).session(session),
        ]);

        txDebit = [existingDebit];
        txCredit = [await TokenTransaction.findOne({
          opId,
          kind,
          direction: "credit",
          fromUserId,
          toUserId,
        }).session(session)];
        

        return;
      }

      // 1) Debit payer (shared rule: balance down; first consume earnings, then redeemable)
      const debit = await debitUserTokensBuckets({
        userId: fromUserId,
        amountTokens: amt,
        session,
      });

      if (!debit.ok) {
        logTokenFlow("ERROR", {
          route: "POST /tokens/transfer",
          fromUserId: String(fromUserId),
          toUserId: String(toUserId),
          code: debit.code === "USER_NOT_FOUND" ? "USER_NOT_FOUND" : "INSUFFICIENT_TOKEN_BALANCE",
          context: safeContext,
          amountTokens: amt,
          eventId: safeContext === "tip" ? String(eventId || "") : null,
          opId,
        });

        const err = new Error("Insufficient token balance to complete the operation.");
        err.statusCode = debit.code === "USER_NOT_FOUND" ? 404 : 400;
        throw err;
      }

      toUser = await User.findById(toUserId)
        .select("_id displayName accountType isVip isCreator creatorEnabled creatorVerification tokenBalance tokenEarnings tokenRedeemable")
        .session(session);

      if (!toUser) {
        const err = new Error("Recipient user not found.");
        err.statusCode = 404;
        throw err;
      }

      /// 🔒 DONATION rule: only VIP profiles can receive donations
      if (safeContext === "donation" && toUser.isVip !== true) {
        logTokenFlow("ERROR", {
          route: "POST /tokens/transfer",
          fromUserId: String(fromUserId),
          toUserId: String(toUserId),
          code: "DONATION_VIP_ONLY",
          context: "donation",
          amountTokens: amt,
          opId,
        });

        const err = new Error("Only VIP profiles can receive donations.");
        err.statusCode = 403;
        throw err;
      }

      // 2) CREDIT rule:
      // - receiver always gets balance += amt
      // - base receiver: earnings += amt
      // - creator approved receiver: redeemable += amt
      const isCreatorVerified =
        (toUser.accountType === "creator" || toUser.isCreator === true) &&
        toUser.creatorEnabled === true &&
        toUser.creatorVerification?.status === "approved";

      goesToEarnings = !isCreatorVerified;

      const inc = { tokenBalance: amt };
      if (isCreatorVerified) inc.tokenRedeemable = amt;
      else inc.tokenEarnings = amt;

      await User.updateOne({ _id: toUserId }, { $inc: inc }, { session });

      // 3) ledger (2 righe) con opId+groupId
      txDebit = await TokenTransaction.create(
        [{
          opId,
          groupId,
          fromUserId,
          toUserId,
          kind,
          direction: "debit",
          context: safeContext,
          amountTokens: amt,
          amountEuro: 0,
          eventId: safeContext === "tip" ? eventId : null,
          metadata: {
            goesToEarnings,
            bucket: goesToEarnings ? "earnings" : "redeemable",
            buyerBuckets: {
              purchased: debit.usedFromPurchased,
              earnings: debit.usedFromEarnings,
              redeemable: debit.usedFromRedeemable,
            },
          },
        }],
        { session }
      );

      txCredit = await TokenTransaction.create(
        [{
          opId,
          groupId,
          fromUserId,
          toUserId,
          kind,
          direction: "credit",
          context: safeContext,
          amountTokens: amt,
          amountEuro: 0,
          eventId: safeContext === "tip" ? eventId : null,
          metadata: { goesToEarnings, bucket: goesToEarnings ? "earnings" : "redeemable" },
        }],
        { session }
      );

      // 3.5) TIP live -> update Event tip total + goal progress (same TX)
      if (safeContext === "tip") {

        const now = new Date();

        const ev = await Event.findById(String(eventId)).session(session);

        if (!ev) {
          const err = new Error("Event not found");
          err.statusCode = 404;
          throw err;
        }

        if (String(ev.status) !== "live") {
          const err = new Error("Event is not live");
          err.statusCode = 400;
          throw err;
        }

        // tip must target host of this event
        if (String(ev.creatorId) !== String(toUserId)) {
          const err = new Error("Tip target mismatch");
          err.statusCode = 400;
          throw err;
        }

        // 🔹 TIP TOTAL ROOT
        ev.tipTotalTokens = Number(ev.tipTotalTokens || 0) + amt;

        // 🔹 GOAL ROOT
        const g = ev.goal || {};
        if (g.isActive === true) {
          g.progressTokens = Number(g.progressTokens || 0) + amt;

          const target = Number(g.targetTokens || 0);
          if (g.reachedAt == null && target > 0 && g.progressTokens >= target) {
            g.progressTokens = target; // clamp
            g.reachedAt = now;
          }

          g.updatedAt = now;
          ev.goal = g;
        }
        
        await ev.save({ session });
      }

      // 4) NOTIFICA al ricevente (dentro TX)
      const label =
        safeContext === "tip" ? "mancia" :
        safeContext === "donation" ? "donazione" :
        safeContext === "cam" ? "token live" :
        safeContext === "content" ? "pagamento contenuto" :
        "token";

      await Notification.create([{
        userId: toUserId,
        actorId: fromUserId,
        type: "TOKEN_RECEIVED",
        targetType: "token_tx",
        targetId: txCredit[0]._id,
        message: `You have received a ${label}: +${amt} token`,
        data: {
          kind,
          context: safeContext,
          amountTokens: amt,
          fromUserId,
          opId,
          groupId,
          goesToEarnings,
        },
        isPersistent: true,
        dedupeKey: `token_tx:${opId}:${kind}:received`,
      }], { session });

      let actionType = null;
      if (safeContext === "donation") actionType = "TOKEN_DONATION";
      if (safeContext === "tip") actionType = "TOKEN_TIP";
      if (safeContext === "cam" || safeContext === "content") actionType = "TOKEN_TRANSFER";

      if (actionType) {
        await TokenAuditLog.create(
          [
            {
              actorUserId: fromUserId,
              targetUserId: toUserId,
              actionType,
              amountTokens: amt,
              opId,
              groupId,
              meta: {
                goesToEarnings,
                context: safeContext,
                eventId: safeContext === "tip" ? String(eventId || "") : null,
              },
            },
          ],
          { session }
        );
      }

      // 5) carico fromUser per risposta (post-update)
      [fromUser, toUser] = await Promise.all([
        User.findById(fromUserId).session(session),
        User.findById(toUserId).session(session),
      ]);
    });

    logTokenFlow("SUCCESS", {
      route: "POST /tokens/transfer",
      fromUserId: String(fromUser?._id || fromUserId),
      toUserId: String(toUser?._id || toUserId),
      opId,
      groupId,
      kind,
      context: safeContext,
      amountTokens: amt,
      eventId: safeContext === "tip" ? String(eventId || "") : null,
      goesToEarnings,
      debitTxId: txDebit?.[0]?._id ? String(txDebit[0]._id) : null,
      creditTxId: txCredit?.[0]?._id ? String(txCredit[0]._id) : null,
    });

    return res.status(201).json({
      message: "Token transfer completed.",
      opId,
      groupId,
      kind,
      context: safeContext,
      fromUser: {
        id: fromUser?._id,
        displayName: fromUser?.displayName,
        tokenBalance: fromUser?.tokenBalance,
        tokenEarnings: fromUser?.tokenEarnings,
        tokenRedeemable: fromUser?.tokenRedeemable,
      },
      toUser: {
        id: toUser?._id,
        displayName: toUser?.displayName,
        tokenBalance: toUser?.tokenBalance,
        accountType: toUser?.accountType,
        tokenEarnings: toUser?.tokenEarnings,
        tokenRedeemable: toUser?.tokenRedeemable,
      },
      transactions: {
        debitTxId: txDebit?.[0]?._id || null,
        creditTxId: txCredit?.[0]?._id || null,
      },
      meta: { goesToEarnings },
    });
  } catch (err) {
    logTokenFlow("ERROR", {
      route: "POST /tokens/transfer",
      fromUserId: String(req.user?._id || ""),
      toUserId: String(req.body?.toUserId || ""),
      context: String(req.body?.context || "").trim() || null,
      amountTokens: Number(req.body?.amountTokens || 0),
      eventId: req.body?.eventId ? String(req.body.eventId) : null,
      message: err?.message || "unknown_error",
      statusCode: err?.statusCode || 500,
      stack: err?.stack || null,
    });

    console.error("Errore POST /tokens/transfer:", err);
    return res.status(err.statusCode || 500).json({
      status: "error",
      message: err.message || "Internal error during token transfer.",
    });
  } finally {
    session.endSession();
  }
});

// --- GET /tokens/transactions ---
// Storico base delle transazioni dell'utente loggato
router.get("/transactions", auth, async (req, res) => {
  try {
    const userId = req.user._id;

    const uid = String(userId);

    const txs = await TokenTransaction.find({
      $or: [
        { fromUserId: uid, direction: "debit" },
        { toUserId: uid, direction: "credit" },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({
      count: txs.length,
      items: txs,
    });
  } catch (err) {
    console.error("Errore GET /tokens/transactions:", err);
    return res
      .status(500)
      .json({ error: "Internal error while fetching transactions." });
  }
});

// --- GET /tokens/me/creator-summary ---
// Solo per creator: riepilogo guadagni e stima payout
router.get("/me/creator-summary", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "displayName accountType tokenBalance tokenEarnings tokenRedeemable"
    );

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    if (user.accountType !== "creator") {
      return res
        .status(403)
        .json({ error: "Access restricted to creator users." });
    }

    const tokenEarnings = user.tokenEarnings || 0;

    const lastTxs = await TokenTransaction.find({
      toUserId: user._id,
      kind: "transfer",
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return res.json({
      userId: user._id,
      displayName: user.displayName,
      accountType: user.accountType,
      balance: Number(user.tokenBalance || 0),
      earnings: Number(user.tokenEarnings || 0),
      redeemable: Number(user.tokenRedeemable || 0),
      lastTransactions: lastTxs,
    });
  } catch (err) {
    console.error("Errore GET /tokens/me/creator-summary:", err);
    return res.status(500).json({
      error:
        "Internal error while fetching the host token summary.",
    });
  }
});

module.exports = router;

