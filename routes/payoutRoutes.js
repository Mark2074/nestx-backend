// routes/payoutRoutes.js
const express = require("express");
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");
const PayoutRequest = require("../models/payoutRequest");
const featureGuard = require("../middleware/featureGuard");
const crypto = require("crypto");
const { reserveRedeemableForPayout } = require("../services/tokenDebitService");

const router = express.Router();

function isEconomyEnabled() {
  return String(process.env.ECONOMY_ENABLED || "false").toLowerCase() === "true";
}


// ---- POLICY (fissa per ora) ----
const MIN_PAYOUT_TOKENS = 100;            // cambia quando vuoi
const MAX_PAYOUT_TOKENS_PER_MONTH = 5000; // cambia quando vuoi
const PAYOUT_WINDOW_MONTHS = 12;

function startOfMonthUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function monthsAgoDateUTC(months) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

function eligibilityFromUser(user) {
  if (!user) return { ok: false, code: "USER_NOT_FOUND" };

  // role
  if (user.accountType !== "creator" && user.isCreator !== true) {
    return { ok: false, code: "NOT_CREATOR" };
  }

  // kill switch
  if (user.creatorEnabled !== true) {
    return { ok: false, code: "CREATOR_DISABLED" };
  }

  // compliance (NEW source of truth)
  if (user.creatorVerification?.status !== "approved") {
    return { ok: false, code: "CREATOR_VERIFICATION_REQUIRED" };
  }

  // payout readiness (Stripe)
  if (user.payoutProvider !== "stripe") return { ok: false, code: "PAYOUT_PROVIDER_NOT_READY" };
  if (user.payoutEnabled !== true) return { ok: false, code: "PAYOUT_NOT_ENABLED" };
  if (user.payoutStatus !== "verified") return { ok: false, code: "PAYOUT_NOT_VERIFIED" };

  return { ok: true, code: "OK" };
}

// GET /api/payout/policy
router.get("/policy", auth, async (req, res) => {
  return res.json({
    status: "ok",
    data: {
      minPayoutTokens: MIN_PAYOUT_TOKENS,
      maxPayoutTokensPerMonth: MAX_PAYOUT_TOKENS_PER_MONTH,
      payoutWindowMonths: PAYOUT_WINDOW_MONTHS,
    },
  });
});

// GET /api/payout/me/eligibility
router.get("/me/eligibility", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("accountType isCreator creatorEnabled creatorVerification payoutProvider payoutEnabled payoutStatus")

    const elig = eligibilityFromUser(user);

    return res.json({
      status: "ok",
      data: elig,
    });
  } catch (e) {
    console.error("payout eligibility error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// GET /api/payout/me/available
router.get("/me/available", auth, async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId).select(
  "accountType isCreator tokenEarnings tokenRedeemable creatorEnabled creatorVerification payoutProvider payoutEnabled payoutStatus");

    // Fase 1A: economy disabled -> values forced to 0 (read-only)
    if (!isEconomyEnabled()) {
      return res.json({
        status: "success",
        data: {
          earnedWindowTokens: 0,
          pendingTokens: 0,
          availableToWithdrawTokens: 0,
          economyEnabled: false,
        },
      });
    }

    const elig = eligibilityFromUser(user);
    if (!elig.ok) {
      return res.json({
        status: "success",
        data: {
          earnedWindowTokens: 0,
          pendingTokens: 0,
          availableToWithdrawTokens: 0,
          economyEnabled: isEconomyEnabled(),
          eligibility: { ok: false, code: elig.code },
        },
      });
    }

    const windowStart = monthsAgoDateUTC(PAYOUT_WINDOW_MONTHS);

    // Pending/approved non ancora pagati
    const pendingAgg = await PayoutRequest.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          status: { $in: ["pending", "approved"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$amountTokens" } } },
    ]);

    const pendingTokens = pendingAgg?.[0]?.total || 0;

    // New logic:
    // tokenRedeemable = currently available bucket
    // pendingTokens = informational only / legacy visibility
    const earnedWindowTokens = Number(user?.tokenRedeemable || 0) + Number(user?.tokenHeld || 0);
    const availableToWithdrawTokens = Math.max(0, Number(user?.tokenRedeemable || 0));

    return res.json({
      status: "success",
      data: {
        earnedWindowTokens,          // (compat) in realtà = tokenRedeemable
        pendingTokens,
        availableToWithdrawTokens,
        economyEnabled: true,
      },
    });
  } catch (e) {
    console.error("payout available error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/payout/request
// Body: { amountTokens }
router.post("/request", auth, featureGuard("tokens"), async (req, res) => {
  if (!isEconomyEnabled()) {
    return res.status(403).json({ status: "error", message: "Economy is disabled during testing." });
  }

  try {
    const userId = req.user._id;
    const { amountTokens } = req.body;

    if (typeof amountTokens !== "number" || !Number.isInteger(amountTokens) || amountTokens <= 0) {
      return res.status(400).json({ status: "error", code: "INVALID_AMOUNT", message: "Invalid amountTokens" });
    }

    const user = await User.findById(userId).select(
  "accountType isCreator tokenRedeemable creatorEnabled creatorVerification payoutProvider payoutEnabled payoutStatus");

    const elig = eligibilityFromUser(user);
    if (!elig.ok) {
      return res.status(403).json({ status: "error", code: elig.code, message: "Not eligible" });
    }

    if (amountTokens < MIN_PAYOUT_TOKENS) {
      return res.status(400).json({
        status: "error",
        code: "BELOW_MIN",
        message: `Minimum payout: ${MIN_PAYOUT_TOKENS} token`,
      });
    }

    const available = Math.max(0, Number(user?.tokenRedeemable || 0));

    if (amountTokens > available) {
      return res.status(400).json({
        status: "error",
        code: "INSUFFICIENT_AVAILABLE",
        message: "Requested amount exceeds available balance.",
        data: { availableToWithdrawTokens: available },
      });
    }

    const monthStart = startOfMonthUTC(new Date());
    const monthAgg = await PayoutRequest.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          requestedAt: { $gte: monthStart },
          status: { $in: ["pending", "approved", "paid"] },
        },
      },
      { $group: { _id: null, total: { $sum: "$amountTokens" } } },
    ]);

    const requestedThisMonth = monthAgg?.[0]?.total || 0;
    if (requestedThisMonth + amountTokens > MAX_PAYOUT_TOKENS_PER_MONTH) {
      return res.status(400).json({
        status: "error",
        code: "MONTHLY_CAP",
        message: "You exceed the maximum monthly payout cap.",
        data: {
          requestedThisMonth,
          maxPerMonth: MAX_PAYOUT_TOKENS_PER_MONTH,
        },
      });
    }

    const session = await mongoose.startSession();
    let doc = null;

    try {
      await session.withTransaction(async () => {
        const reserve = await reserveRedeemableForPayout({
          userId,
          amountTokens,
          session,
        });

        if (!reserve.ok) {
          const err = new Error(
            reserve.code === "INSUFFICIENT_REDEEMABLE"
              ? "Requested amount exceeds available balance."
              : "Unable to reserve payout amount."
          );
          err.statusCode = reserve.code === "INSUFFICIENT_REDEEMABLE" ? 400 : 500;
          throw err;
        }

        doc = await PayoutRequest.create(
          [
            {
              userId,
              amountTokens,
              status: "pending",
              provider: "stripe",
              requestedAt: new Date(),
              audit: [{ action: "request", byAdminId: null, at: new Date(), note: null }],
            },
          ],
          { session }
        ).then((rows) => rows[0]);

        await TokenTransaction.create(
          [
            {
              opId: `payout_${crypto.randomUUID()}`,
              groupId: `grp_${crypto.randomUUID()}`,
              fromUserId: userId,
              toUserId: null,
              kind: "payout",
              direction: "debit",
              context: "system",
              contextId: doc._id,
              amountTokens,
              amountEuro: 0,
              metadata: {
                stage: "request_hold",
                payoutRequestId: String(doc._id),
                provider: "stripe",
              },
            },
          ],
          { session }
        );
      });
    } finally {
      session.endSession();
    }

    return res.status(201).json({ status: "ok", data: doc });
  } catch (e) {
    console.error("payout request error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
