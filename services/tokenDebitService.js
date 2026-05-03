// services/tokenDebitService.js
const User = require("../models/user");

function n(v) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

// Invariant:
// tokenBalance = tokenPurchased + tokenEarnings + tokenRedeemable + tokenHeld
function normalizeUserTokenState(u) {
  u.tokenPurchased = Math.max(0, n(u.tokenPurchased));
  u.tokenEarnings = Math.max(0, n(u.tokenEarnings));
  u.tokenRedeemable = Math.max(0, n(u.tokenRedeemable));
  u.tokenHeld = Math.max(0, n(u.tokenHeld));

  u.tokenBalance =
    u.tokenPurchased +
    u.tokenEarnings +
    u.tokenRedeemable +
    u.tokenHeld;

  return u;
}

async function getLockedUser(userId, session) {
  return User.findById(userId)
    .select("_id tokenBalance tokenPurchased tokenEarnings tokenRedeemable tokenHeld")
    .session(session);
}

// Spendable = purchased + earnings + redeemable
// Spendable = purchased + earnings + redeemable
async function debitUserTokensBuckets({ userId, amountTokens, session }) {
  const amt = Number(amountTokens || 0);

  if (!Number.isFinite(amt) || amt <= 0) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      usedFromPurchased: 0,
      usedFromEarnings: 0,
      usedFromRedeemable: 0,
    };
  }

  const u = await User.findById(userId)
    .select("_id tokenBalance tokenPurchased tokenEarnings tokenRedeemable tokenHeld")
    .lean()
    .session(session);

  if (!u) {
    return {
      ok: false,
      code: "USER_NOT_FOUND",
      usedFromPurchased: 0,
      usedFromEarnings: 0,
      usedFromRedeemable: 0,
    };
  }

  const purchased = n(u.tokenPurchased);
  const earnings = n(u.tokenEarnings);
  const redeemable = n(u.tokenRedeemable);
  const held = n(u.tokenHeld);

  const spendable = purchased + earnings + redeemable;

  if (spendable < amt) {
    return {
      ok: false,
      code: "INSUFFICIENT_TOKENS",
      usedFromPurchased: 0,
      usedFromEarnings: 0,
      usedFromRedeemable: 0,
    };
  }

  let remaining = amt;

  const usePurchased = Math.min(purchased, remaining);
  remaining -= usePurchased;

  const useEarnings = Math.min(earnings, remaining);
  remaining -= useEarnings;

  const useRedeemable = Math.min(redeemable, remaining);
  remaining -= useRedeemable;

  if (remaining > 0) {
    return {
      ok: false,
      code: "TOKEN_BUCKETS_INCONSISTENT",
      usedFromPurchased: usePurchased,
      usedFromEarnings: useEarnings,
      usedFromRedeemable: useRedeemable,
    };
  }

  const newPurchased = purchased - usePurchased;
  const newEarnings = earnings - useEarnings;
  const newRedeemable = redeemable - useRedeemable;
  const newHeld = held;
  const newBalance = newPurchased + newEarnings + newRedeemable + newHeld;

  const updated = await User.updateOne(
    {
      _id: userId,
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

  if (updated.modifiedCount !== 1) {
    return {
      ok: false,
      code: "TOKEN_WRITE_CONFLICT",
      usedFromPurchased: 0,
      usedFromEarnings: 0,
      usedFromRedeemable: 0,
    };
  }

  return {
    ok: true,
    code: "OK",
    usedFromPurchased: usePurchased,
    usedFromEarnings: useEarnings,
    usedFromRedeemable: useRedeemable,
    newTokenBalance: newBalance,
    newTokenPurchased: newPurchased,
    newTokenEarnings: newEarnings,
    newTokenRedeemable: newRedeemable,
    newTokenHeld: newHeld,
  };
}

// Move spendable buckets -> held. tokenBalance stays the same.
async function reserveUserTokensBuckets({ userId, amountTokens, session }) {
  const amt = Number(amountTokens || 0);
  if (!Number.isFinite(amt) || amt <= 0) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      movedFromPurchased: 0,
      movedFromEarnings: 0,
      movedFromRedeemable: 0,
    };
  }

  const u = await getLockedUser(userId, session);
  if (!u) {
    return { ok: false, code: "USER_NOT_FOUND", movedFromPurchased: 0, movedFromEarnings: 0, movedFromRedeemable: 0 };
  }

  const purchased = n(u.tokenPurchased);
  const earnings = n(u.tokenEarnings);
  const redeemable = n(u.tokenRedeemable);

  const spendable = purchased + earnings + redeemable;
  if (spendable < amt) {
    return { ok: false, code: "INSUFFICIENT_TOKENS", movedFromPurchased: 0, movedFromEarnings: 0, movedFromRedeemable: 0 };
  }

  let remaining = amt;

  const movePurchased = Math.min(purchased, remaining);
  remaining -= movePurchased;

  const moveEarnings = Math.min(earnings, remaining);
  remaining -= moveEarnings;

  const moveRedeemable = Math.min(redeemable, remaining);
  remaining -= moveRedeemable;

  if (remaining > 0) {
    return {
      ok: false,
      code: "TOKEN_BUCKETS_INCONSISTENT",
      movedFromPurchased: movePurchased,
      movedFromEarnings: moveEarnings,
      movedFromRedeemable: moveRedeemable,
    };
  }

  u.tokenPurchased = purchased - movePurchased;
  u.tokenEarnings = earnings - moveEarnings;
  u.tokenRedeemable = redeemable - moveRedeemable;
  u.tokenHeld = n(u.tokenHeld) + amt;

  normalizeUserTokenState(u);
  await u.save({ session });

  return {
    ok: true,
    code: "OK",
    movedFromPurchased: movePurchased,
    movedFromEarnings: moveEarnings,
    movedFromRedeemable: moveRedeemable,
    newTokenBalance: n(u.tokenBalance),
    newTokenPurchased: n(u.tokenPurchased),
    newTokenEarnings: n(u.tokenEarnings),
    newTokenRedeemable: n(u.tokenRedeemable),
    newTokenHeld: n(u.tokenHeld),
  };
}

// Payout hold must come only from redeemable bucket.
async function reserveRedeemableForPayout({ userId, amountTokens, session }) {
  const amt = Number(amountTokens || 0);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, code: "INVALID_AMOUNT" };
  }

  const u = await getLockedUser(userId, session);
  if (!u) return { ok: false, code: "USER_NOT_FOUND" };

  const redeemable = n(u.tokenRedeemable);
  if (redeemable < amt) {
    return { ok: false, code: "INSUFFICIENT_REDEEMABLE" };
  }

  u.tokenRedeemable = redeemable - amt;
  u.tokenHeld = n(u.tokenHeld) + amt;

  normalizeUserTokenState(u);
  await u.save({ session });

  return {
    ok: true,
    code: "OK",
    movedFromRedeemable: amt,
    newTokenBalance: n(u.tokenBalance),
    newTokenPurchased: n(u.tokenPurchased),
    newTokenEarnings: n(u.tokenEarnings),
    newTokenRedeemable: n(u.tokenRedeemable),
    newTokenHeld: n(u.tokenHeld),
  };
}

module.exports = {
  normalizeUserTokenState,
  debitUserTokensBuckets,
  reserveUserTokensBuckets,
  reserveRedeemableForPayout,
};