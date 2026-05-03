const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");

function n(v) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

async function chargeUserToCreator({
  buyerId,
  creatorId,
  amountTokens,
  kind,
  context,
  contextId,
  eventId,
  scope,
  roomId,
  creatorBucket = "held",
  metadata = {},
  session,
  opId,
  groupId,
}) {
  const amt = Number(amountTokens || 0);

  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, code: "INVALID_AMOUNT" };
  }

  const buyer = await User.findById(buyerId)
    .select("_id tokenPurchased tokenEarnings tokenRedeemable tokenHeld")
    .lean()
    .session(session);

  if (!buyer) return { ok: false, code: "BUYER_NOT_FOUND" };

  const purchased = n(buyer.tokenPurchased);
  const earnings = n(buyer.tokenEarnings);
  const redeemable = n(buyer.tokenRedeemable);
  const held = n(buyer.tokenHeld);

  const spendable = purchased + earnings + redeemable;
  if (spendable < amt) {
    return { ok: false, code: "INSUFFICIENT_TOKENS" };
  }

  let remaining = amt;

  const usedFromPurchased = Math.min(purchased, remaining);
  remaining -= usedFromPurchased;

  const usedFromEarnings = Math.min(earnings, remaining);
  remaining -= usedFromEarnings;

  const usedFromRedeemable = Math.min(redeemable, remaining);
  remaining -= usedFromRedeemable;

  const newPurchased = purchased - usedFromPurchased;
  const newEarnings = earnings - usedFromEarnings;
  const newRedeemable = redeemable - usedFromRedeemable;
  const newHeld = held;
  const newBalance = newPurchased + newEarnings + newRedeemable + newHeld;

  const debitUpdate = await User.updateOne(
    {
      _id: buyerId,
      tokenPurchased: purchased,
      tokenEarnings: earnings,
      tokenRedeemable: redeemable,
      tokenHeld: held,
    },
    {
      $set: {
        tokenPurchased: newPurchased,
        tokenEarnings: newEarnings,
        tokenRedeemable: newRedeemable,
        tokenHeld: newHeld,
        tokenBalance: newBalance,
      },
    },
    { session }
  );

  if (debitUpdate.modifiedCount !== 1) {
    return { ok: false, code: "TOKEN_WRITE_CONFLICT" };
  }

  const creatorInc = { tokenBalance: amt };

  if (creatorBucket === "redeemable") creatorInc.tokenRedeemable = amt;
  else if (creatorBucket === "earnings") creatorInc.tokenEarnings = amt;
  else creatorInc.tokenHeld = amt;

  const creditUpdate = await User.updateOne(
    { _id: creatorId },
    { $inc: creatorInc },
    { session }
  );

  if (creditUpdate.modifiedCount !== 1) {
    return { ok: false, code: "CREATOR_NOT_FOUND" };
  }

  await TokenTransaction.insertMany(
    [
      {
        opId,
        groupId,
        fromUserId: buyerId,
        toUserId: creatorId,
        kind,
        direction: "debit",
        context,
        contextId,
        amountTokens: amt,
        amountEuro: 0,
        eventId,
        scope,
        roomId,
        metadata: {
          ...metadata,
          buyerBuckets: {
            purchased: usedFromPurchased,
            earnings: usedFromEarnings,
            redeemable: usedFromRedeemable,
          },
          creatorBucket,
        },
      },
      {
        opId,
        groupId,
        fromUserId: buyerId,
        toUserId: creatorId,
        kind,
        direction: "credit",
        context,
        contextId,
        amountTokens: amt,
        amountEuro: 0,
        eventId,
        scope,
        roomId,
        metadata: {
          ...metadata,
          creatorBucket,
        },
      },
    ],
    { session, ordered: true }
  );

  return {
    ok: true,
    code: "OK",
    usedFromPurchased,
    usedFromEarnings,
    usedFromRedeemable,
    newTokenBalance: newBalance,
  };
}

module.exports = {
  chargeUserToCreator,
};