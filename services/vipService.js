const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");
const { debitUserTokensBuckets } = require("./tokenDebitService");

const VIP_PRICE = 80;
const VIP_DAYS = 30;

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d;
}

function vipActive(u, now) {
  return u?.isVip === true && u?.vipExpiresAt && new Date(u.vipExpiresAt) > now;
}

// Normalizza stato VIP senza rinnovi (no charge)
async function normalizeVipFlags({ user, now, session }) {
  const exp = user.vipExpiresAt ? new Date(user.vipExpiresAt) : null;
  if (!exp || exp <= now) {
    // scaduto o non impostato
    if (user.isVip !== false) user.isVip = false;
    if (user.vipAutoRenew !== false) user.vipAutoRenew = false;
  }
  await user.save({ session });
  return user;
}

/**
 * maybeRenewVip(userId)
 * - usa SERVER TIME (new Date())
 * - rinnova solo se vipAutoRenew=true e vipExpiresAt<=now
 * - idempotenza renew via opId deterministico (evita doppi addebiti in race)
 */
async function maybeRenewVip(userId) {
  const now = new Date();
  const session = await mongoose.startSession();

  try {
    let result = null;

    await session.withTransaction(async () => {
      const user = await User.findById(userId)
        .select("_id isVip vipExpiresAt vipAutoRenew vipSince tokenBalance tokenEarnings tokenRedeemable")
        .session(session);

      if (!user) return;

      const exp = user.vipExpiresAt ? new Date(user.vipExpiresAt) : null;

      // Se non deve rinnovare: solo normalizzazione flags
      if (!user.vipAutoRenew || !exp || exp > now) {
        await normalizeVipFlags({ user, now, session });
        result = { renewed: false, active: vipActive(user, now), user };
        return;
      }

      // Qui: vipAutoRenew=true AND exp<=now
      const bal = Number(user.tokenBalance || 0);

      if (bal < VIP_PRICE) {
        // non abbastanza token: scade + disattiva autoRenew
        user.isVip = false;
        user.vipAutoRenew = false;
        await user.save({ session });
        result = { renewed: false, active: false, user };
        return;
      }

      // opId renew deterministico (idempotenza per race / retry)
      // cycleKey a livello giorno UTC è sufficiente (un solo rinnovo possibile)
      const cycleKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const opId = `vip_renew:${String(user._id)}:${cycleKey}`;
      const groupId = opId;

      // Inserisco PRIMA la tx (dentro transaction): se dup => già rinnovato
      try {
        await TokenTransaction.create(
          [
            {
              opId,
              groupId,
              fromUserId: user._id,
              toUserId: null,
              kind: "vip_purchase",
              direction: "debit",
              context: "system",
              contextId: null,
              amountTokens: VIP_PRICE,
              amountEuro: 0,
              metadata: {
                vipDays: VIP_DAYS,
                priceTokens: VIP_PRICE,
                reason: "vip_renew",
              },
            },
          ],
          { session }
        );
      } catch (e) {
        // duplicate => qualcun altro ha già rinnovato
        if (e?.code === 11000) {
          // ricarica stato e basta
          const u2 = await User.findById(userId)
            .select("_id isVip vipExpiresAt vipAutoRenew vipSince")
            .session(session);
          result = { renewed: false, active: vipActive(u2, now), user: u2 };
          return;
        }
        throw e;
      }

      // Scala token in modo consistente (bucket)
      const debit = await debitUserTokensBuckets({
        userId: user._id,
        amountTokens: VIP_PRICE,
        session,
      });

      if (!debit.ok) {
        throw new Error(`VIP_RENEW_DEBIT_FAILED:${debit.code}`);
      }

      user.vipExpiresAt = addDays(now, VIP_DAYS);
      user.isVip = true;

      if (!user.vipSince) user.vipSince = now;

      await user.save({ session });

      result = { renewed: true, active: true, user };
    });

    return result || { renewed: false, active: false, user: null };
  } finally {
    session.endSession();
  }
}

async function buyVip(userId) {
  const now = new Date();
  const session = await mongoose.startSession();

  try {
    let out = null;

    await session.withTransaction(async () => {
      const user = await User.findById(userId)
        .select("_id isVip vipExpiresAt vipAutoRenew vipSince tokenBalance tokenEarnings tokenRedeemable")
        .session(session);

      if (!user) throw new Error("USER_NOT_FOUND");

      const bal = Number(user.tokenBalance || 0);
      if (bal < VIP_PRICE) {
        const err = new Error("INSUFFICIENT_TOKENS");
        err.code = "INSUFFICIENT_TOKENS";
        throw err;
      }

      // opId buy random (no idempotency richiesta)
      const opId = `vip_buy:${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")}`;
      const groupId = opId;

      await TokenTransaction.create(
        [
          {
            opId,
            groupId,
            fromUserId: user._id,
            toUserId: null,
            kind: "vip_purchase",
            direction: "debit",
            context: "system",
            contextId: null,
            amountTokens: VIP_PRICE,
            amountEuro: 0,
            metadata: {
              vipDays: VIP_DAYS,
              priceTokens: VIP_PRICE,
              reason: "vip_buy",
            },
          },
        ],
        { session }
      );

      const debit = await debitUserTokensBuckets({
        userId: user._id,
        amountTokens: VIP_PRICE,
        session,
      });

      if (!debit.ok) {
        throw new Error(`VIP_BUY_DEBIT_FAILED:${debit.code}`);
      }

      const exp = user.vipExpiresAt ? new Date(user.vipExpiresAt) : null;
      const isActiveNow = vipActive(user, now);

      if (isActiveNow && exp) {
        user.vipExpiresAt = addDays(exp, VIP_DAYS);
      } else {
        user.vipExpiresAt = addDays(now, VIP_DAYS);
      }

      user.isVip = true;
      user.vipAutoRenew = true;

      if (!user.vipSince) user.vipSince = now;

      await user.save({ session });

      out = { ok: true, user };
    });

    return out;
  } finally {
    session.endSession();
  }
}

async function cancelVipAutoRenew(userId) {
  const now = new Date();
  const user = await User.findById(userId).select("_id isVip vipExpiresAt vipAutoRenew vipSince");
  if (!user) return null;

  user.vipAutoRenew = false;

  // Se già scaduto, normalizza (no renew, no charge)
  const exp = user.vipExpiresAt ? new Date(user.vipExpiresAt) : null;
  if (!exp || exp <= now) {
    user.isVip = false;
    user.vipAutoRenew = false;
  }

  await user.save();
  return user;
}

module.exports = {
  VIP_PRICE,
  VIP_DAYS,
  maybeRenewVip,
  buyVip,
  cancelVipAutoRenew,
};