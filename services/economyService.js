const mongoose = require("mongoose");
const crypto = require("crypto");

const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");
const DailyQuota = require("../models/dailyQuota");
const Adv = require("../models/adv");
const ShowcaseItem = require("../models/showcaseItem");

function makeOpId(req, fallbackPrefix = "op") {
  const hdr = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
  if (hdr && typeof hdr === "string" && hdr.trim().length >= 8) return hdr.trim();
  return `${fallbackPrefix}_${crypto.randomUUID()}`;
}

function dayKeyUTC(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// ===== TIP / DONATION (user -> user) =====
async function tipOrDonation({ fromUserId, toUserId, amountTokens, contextId, isDonation, req }) {
  const opId = makeOpId(req, isDonation ? "don" : "tip");
  const groupId = `grp_${crypto.randomUUID()}`;
  const kind = isDonation ? "donation" : "tip";
  const ctx = isDonation ? "donation" : "tip";

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const existing = await TokenTransaction.findOne({
        opId,
        kind,
        direction: "debit",
        fromUserId,
        toUserId,
      }).session(session);

      if (existing) {
        result = { ok: true, opId, groupId: existing.groupId, idempotent: true };
        return;
      }

      if (String(fromUserId) === String(toUserId)) {
        const err = new Error("Self transfer is not allowed");
        err.statusCode = 400;
        throw err;
      }

      const amt = Number(amountTokens);
      if (!Number.isFinite(amt) || amt <= 0) {
        const err = new Error("Invalid amountTokens");
        err.statusCode = 400;
        throw err;
      }

      const debit = await User.updateOne(
        { _id: fromUserId, tokenBalance: { $gte: amt } },
        { $inc: { tokenBalance: -amt } },
        { session }
      );
      if (debit.modifiedCount !== 1) {
        const err = new Error("Insufficient tokens");
        err.statusCode = 400;
        throw err;
      }

      const receiver = await User.findById(toUserId)
        .select("accountType isCreator creatorEnabled creatorVerification payoutEnabled payoutStatus tokenBalance tokenEarnings tokenRedeemable isVip")
        .session(session);

      if (!receiver) {
        const err = new Error("Receiver not found");
        err.statusCode = 404;
        throw err;
      }

      // donation rule (coerente con routes/tokens.js)
      if (isDonation === true && receiver.isVip !== true) {
        const err = new Error("Only VIP profiles can receive donations.");
        err.statusCode = 403;
        throw err;
      }

      const isCreatorVerifiedForRedeemable =
        (receiver.accountType === "creator" || receiver.isCreator === true) &&
        receiver.creatorEnabled === true &&
        receiver.creatorVerification?.status === "approved";

      // receiver always gets balance += amt
      // base/non-withdrawable creator: earnings += amt
      // withdraw-approved creator: redeemable += amt
      const inc = { tokenBalance: amt };
      if (isCreatorVerifiedForRedeemable) inc.tokenRedeemable = amt;
      else inc.tokenEarnings = amt;

      await User.updateOne(
        { _id: toUserId },
        { $inc: inc },
        { session }
      );

      // legacy flag for UI/debug
      const goesToEarnings = !isCreatorVerifiedForRedeemable;

      await TokenTransaction.create(
        [
          {
            opId,
            groupId,
            fromUserId,
            toUserId,
            kind,
            direction: "debit",
            context: ctx,
            contextId,
            amountTokens: amt,
            metadata: { goesToEarnings },
          },
          {
            opId,
            groupId,
            fromUserId,
            toUserId,
            kind,
            direction: "credit",
            context: ctx,
            contextId,
            amountTokens: amt,
            metadata: { goesToEarnings },
          },
        ],
        { session }
      );

      result = { ok: true, opId, groupId, idempotent: false };
    });
    return result;
  } finally {
    session.endSession();
  }
}

// ===== ADV create (quota + paid debit + pending) =====
async function createAdvCampaign({ creatorId, advData, freeLimit, paidPriceTokens, req }) {
  const opId = makeOpId(req, "adv");
  const groupId = `grp_${crypto.randomUUID()}`;
  const dk = dayKeyUTC(new Date());

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const existing = await Adv.findOne({ opId }).session(session);
      if (existing) {
        result = { ok: true, opId, advId: existing._id, billingType: existing.billingType, idempotent: true };
        return;
      }

      await DailyQuota.updateOne(
        { userId: creatorId, dayKey: dk },
        { $setOnInsert: { advFreeUsed: 0, advPaidUsed: 0, showcaseFreeUsed: 0, showcasePaidUsed: 0 } },
        { upsert: true, session }
      );

      let billingType = "free";
      let paidTokens = 0;

      const freeInc = await DailyQuota.updateOne(
        { userId: creatorId, dayKey: dk, advFreeUsed: { $lt: freeLimit } },
        { $inc: { advFreeUsed: 1 } },
        { session }
      );

      if (freeInc.modifiedCount !== 1) {
        billingType = "paid";
        paidTokens = Number(paidPriceTokens);

        const debit = await User.updateOne(
          { _id: creatorId, tokenBalance: { $gte: paidTokens } },
          { $inc: { tokenBalance: -paidTokens } },
          { session }
        );
        if (debit.modifiedCount !== 1) {
          const err = new Error("Insufficient tokens");
          err.statusCode = 400;
          throw err;
        }

        await DailyQuota.updateOne(
          { userId: creatorId, dayKey: dk },
          { $inc: { advPaidUsed: 1 } },
          { session }
        );
      }

      const [advDoc] = await Adv.create(
        [
          {
            ...advData,
            creatorId,
            opId,
            billingType,
            paidTokens,
            chargedGroupId: billingType === "paid" ? groupId : null,
            reviewStatus: "pending",
            isActive: true,
          },
        ],
        { session }
      );

      if (billingType === "paid") {
        await TokenTransaction.create(
          [
            {
              opId,
              groupId,
              fromUserId: creatorId,
              toUserId: null,
              kind: "adv_purchase",
              direction: "debit",
              context: "adv",
              contextId: advDoc._id,
              amountTokens: paidTokens,
              metadata: { dayKey: dk },
            },
          ],
          { session }
        );
      }

      result = { ok: true, opId, advId: advDoc._id, billingType, paidTokens, idempotent: false };
    });

    return result;
  } finally {
    session.endSession();
  }
}

// ===== Showcase item create (quota + paid debit + pending) =====
async function createShowcaseItem({ creatorId, itemData, freeLimit, paidPriceTokens, req }) {
  const opId = makeOpId(req, "show");
  const groupId = `grp_${crypto.randomUUID()}`;
  const dk = dayKeyUTC(new Date());

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const existing = await ShowcaseItem.findOne({ opId }).session(session);
      if (existing) {
        result = { ok: true, opId, showcaseId: existing._id, billingType: existing.billingType, idempotent: true };
        return;
      }

      await DailyQuota.updateOne(
        { userId: creatorId, dayKey: dk },
        { $setOnInsert: { advFreeUsed: 0, advPaidUsed: 0, showcaseFreeUsed: 0, showcasePaidUsed: 0 } },
        { upsert: true, session }
      );

      let billingType = "free";
      let paidTokens = 0;

      const freeInc = await DailyQuota.updateOne(
        { userId: creatorId, dayKey: dk, showcaseFreeUsed: { $lt: freeLimit } },
        { $inc: { showcaseFreeUsed: 1 } },
        { session }
      );

      if (freeInc.modifiedCount !== 1) {
        billingType = "paid";
        paidTokens = Number(paidPriceTokens);

        const debit = await User.updateOne(
          { _id: creatorId, tokenBalance: { $gte: paidTokens } },
          { $inc: { tokenBalance: -paidTokens } },
          { session }
        );
        if (debit.modifiedCount !== 1) {
          const err = new Error("Insufficient tokens");
          err.statusCode = 400;
          throw err;
        }

        await DailyQuota.updateOne(
          { userId: creatorId, dayKey: dk },
          { $inc: { showcasePaidUsed: 1 } },
          { session }
        );
      }

      const [itemDoc] = await ShowcaseItem.create(
        [
          {
            ...itemData,
            creatorId,
            opId,
            billingType,
            paidTokens,
            chargedGroupId: billingType === "paid" ? groupId : null,
            reviewStatus: "pending",
            isActive: true,
          },
        ],
        { session }
      );

      if (billingType === "paid") {
        await TokenTransaction.create(
          [
            {
              opId,
              groupId,
              fromUserId: creatorId,
              toUserId: null,
              kind: "showcase_purchase",
              direction: "debit",
              context: "showcase",
              contextId: itemDoc._id,
              amountTokens: paidTokens,
              metadata: { dayKey: dk },
            },
          ],
          { session }
        );
      }

      result = { ok: true, opId, showcaseId: itemDoc._id, billingType, paidTokens, idempotent: false };
    });

    return result;
  } finally {
    session.endSession();
  }
}

module.exports = {
  tipOrDonation,
  createAdvCampaign,
  createShowcaseItem,
};
