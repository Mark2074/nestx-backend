const mongoose = require("mongoose");
const crypto = require("crypto");

const Event = require("../models/event");
const User = require("../models/user");
const Ticket = require("../models/ticket");
const TokenTransaction = require("../models/tokenTransaction");
const Report = require("../models/Report");

const HOLD_MS = 24 * 60 * 60 * 1000;

function isCreatorEligibleForRedeemableBucket(host) {
  return (
    (host?.accountType === "creator" || host?.isCreator === true) &&
    host?.creatorEnabled === true &&
    host?.creatorVerification?.status === "approved"
  );
}

async function hasOpenClaimForEvent(eventId, session) {
  const open = await Report.findOne({
    status: { $in: ["pending", "hidden"] },
    $or: [
      { targetType: "event", targetId: eventId },
      { contextType: "live", contextId: eventId },
    ],
  })
    .select("_id")
    .session(session)
    .lean();

  return !!open;
}

async function releaseSingleHeldCredit({ tx, session }) {
  const amount = Number(tx.amountTokens || 0);
  if (!(amount > 0)) return { released: false, reason: "INVALID_AMOUNT" };

  const eventId = tx.eventId;
  const hostId = tx.toUserId;
  const buyerId = tx.fromUserId;
  const roomId = tx.roomId || null;

  if (!eventId || !hostId || !buyerId) {
    return { released: false, reason: "MISSING_IDS" };
  }

  const event = await Event.findById(eventId).session(session);
  if (!event) return { released: false, reason: "EVENT_NOT_FOUND" };

  if (String(event.status) !== "finished") {
    return { released: false, reason: "EVENT_NOT_FINISHED" };
  }

  const endedAt =
    event.live?.endedAt ||
    event.endedAt ||
    event.updatedAt ||
    event.createdAt;

  if (!endedAt || Date.now() - new Date(endedAt).getTime() < HOLD_MS) {
    return { released: false, reason: "HOLD_WINDOW_ACTIVE" };
  }

  const hasClaim = await hasOpenClaimForEvent(event._id, session);

  if (hasClaim) {
    if (event.privateSession?.economicStatus === "held") {
      event.privateSession.economicStatus = "frozen";
      event.privateSession.economicFrozenAt = new Date();
      event.privateSession.economicResolutionReason = "CLAIM_OPENED_BEFORE_RELEASE";
      await event.save({ session });
    }

    return { released: false, reason: "CLAIM_OPEN" };
  }

  const ticketQuery = {
    eventId,
    userId: buyerId,
    scope: "private",
    status: "active",
  };

  ticketQuery.roomId = roomId || null;

  const ticket = await Ticket.findOne(ticketQuery).session(session);
  if (!ticket) return { released: false, reason: "ACTIVE_TICKET_NOT_FOUND" };

  const opId = `privrelease_${String(ticket._id)}`;

  const existingRelease = await TokenTransaction.findOne({
    opId,
    kind: "private_release",
    direction: "credit",
    eventId,
    scope: "private",
    roomId,
  }).session(session);

  if (existingRelease) return { released: false, reason: "ALREADY_RELEASED" };

  const existingRefund = await TokenTransaction.findOne({
    kind: "ticket_refund",
    direction: "credit",
    eventId,
    scope: "private",
    roomId,
    toUserId: buyerId,
    amountTokens: amount,
  }).session(session);

  if (existingRefund) return { released: false, reason: "ALREADY_REFUNDED" };

  const host = await User.findById(hostId)
    .select("_id accountType isCreator creatorEnabled creatorVerification tokenHeld tokenEarnings tokenRedeemable")
    .session(session);

  if (!host) throw new Error(`Host not found: ${hostId}`);

  const releaseTargetBucket = isCreatorEligibleForRedeemableBucket(host)
    ? "redeemable"
    : "earnings";

  const inc =
    releaseTargetBucket === "redeemable"
      ? { tokenHeld: -amount, tokenRedeemable: amount }
      : { tokenHeld: -amount, tokenEarnings: amount };

  const update = await User.updateOne(
    { _id: hostId, tokenHeld: { $gte: amount } },
    { $inc: inc },
    { session }
  );

  if (update.modifiedCount !== 1) {
    throw new Error(`INSUFFICIENT_HELD_FOR_RELEASE tx=${tx._id}`);
  }

  const groupId = `grp_${crypto.randomUUID()}`;

  await TokenTransaction.insertMany(
    [
      {
        opId,
        groupId,
        fromUserId: hostId,
        toUserId: hostId,
        kind: "private_release",
        direction: "debit",
        context: "ticket",
        contextId: String(eventId),
        amountTokens: amount,
        amountEuro: 0,
        eventId,
        scope: "private",
        roomId,
        metadata: {
          fromBucket: "held",
          toBucket: releaseTargetBucket,
          originalTicketId: ticket._id,
          originalOpId: tx.opId || null,
          originalKind: tx.kind,
          reason: "AUTO_RELEASE_24H",
        },
      },
      {
        opId,
        groupId,
        fromUserId: hostId,
        toUserId: hostId,
        kind: "private_release",
        direction: "credit",
        context: "ticket",
        contextId: String(eventId),
        amountTokens: amount,
        amountEuro: 0,
        eventId,
        scope: "private",
        roomId,
        metadata: {
          fromBucket: "held",
          toBucket: releaseTargetBucket,
          originalTicketId: ticket._id,
          originalOpId: tx.opId || null,
          originalKind: tx.kind,
          reason: "AUTO_RELEASE_24H",
        },
      },
    ],
    { session, ordered: true }
  );

  if (event.privateSession?.economicStatus === "held") {
    event.privateSession.economicStatus = "released";
    event.privateSession.economicReleasedAt = new Date();
    event.privateSession.economicResolutionReason = "AUTO_RELEASE_24H";
    await event.save({ session });
  }

  return {
    released: true,
    amount,
    toBucket: releaseTargetBucket,
  };
}

async function releaseEligiblePrivateHeldFunds({ limit = 50 } = {}) {
  const cutoff = new Date(Date.now() - HOLD_MS);

  const heldCredits = await TokenTransaction.find({
    kind: { $in: ["ticket_purchase", "private_purchase"] },
    direction: "credit",
    scope: "private",
    "metadata.creatorBucket": "held",
    "metadata.privateFundsStatus": "held",
    createdAt: { $lte: cutoff },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  let releasedOps = 0;
  let releasedTokens = 0;
  let skipped = 0;
  let failed = 0;

  for (const tx of heldCredits) {
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const result = await releaseSingleHeldCredit({ tx, session });

        if (result.released) {
          releasedOps += 1;
          releasedTokens += Number(result.amount || 0);
        } else {
          skipped += 1;
        }
      });
    } catch (err) {
      failed += 1;
      console.error("PRIVATE_HELD_RELEASE_FAILED", {
        txId: String(tx._id),
        eventId: tx.eventId ? String(tx.eventId) : null,
        amount: tx.amountTokens,
        message: err?.message || err,
      });
    } finally {
      session.endSession();
    }
  }

  return {
    scanned: heldCredits.length,
    releasedOps,
    releasedTokens,
    skipped,
    failed,
  };
}

module.exports = {
  releaseEligiblePrivateHeldFunds,
};