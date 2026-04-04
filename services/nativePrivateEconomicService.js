const crypto = require("crypto");
const Event = require("../models/event");
const Ticket = require("../models/ticket");
const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");

function isCreatorEligibleForRedeemableBucket(creator) {
  return (
    (creator?.accountType === "creator" || creator?.isCreator === true) &&
    creator?.creatorEnabled === true &&
    creator?.creatorVerification?.status === "approved"
  );
}

async function freezeNativePrivateHeldEvent({
  eventId,
  adminId = null,
  now = new Date(),
  reason = "ADMIN_FROZEN",
}) {
  const mongoose = require("mongoose");
  const session = await mongoose.startSession();

  try {
    let result = {
      processed: false,
      alreadyFrozen: false,
      eventId: String(eventId || ""),
      statusBefore: null,
      statusAfter: null,
    };

    await session.withTransaction(async () => {
      const event = await Event.findOne({
        _id: eventId,
        accessScope: "private",
        status: "finished",
      }).session(session);

      if (!event) {
        const err = new Error("EVENT_NOT_FOUND");
        err.httpStatus = 404;
        err.payload = {
          status: "error",
          code: "EVENT_NOT_FOUND",
          message: "Event not found",
        };
        throw err;
      }

      const currentEconomicStatus = String(event?.privateSession?.economicStatus || "none")
        .trim()
        .toLowerCase();

      result.statusBefore = currentEconomicStatus;

      if (currentEconomicStatus === "frozen") {
        result.processed = true;
        result.alreadyFrozen = true;
        result.statusAfter = "frozen";
        return;
      }

      if (currentEconomicStatus !== "held") {
        const err = new Error("PRIVATE_FUNDS_NOT_FREEZABLE");
        err.httpStatus = 409;
        err.payload = {
          status: "error",
          code: "PRIVATE_FUNDS_NOT_FREEZABLE",
          message: "Only held native private funds can be frozen",
          data: {
            economicStatus: currentEconomicStatus,
          },
        };
        throw err;
      }

      if (!event.privateSession) event.privateSession = {};

      event.privateSession.economicStatus = "frozen";
      event.privateSession.economicFrozenAt = now;
      event.privateSession.economicResolutionReason = reason;

      await event.save({ session });

      result.processed = true;
      result.alreadyFrozen = false;
      result.statusAfter = "frozen";
    });

    return result;
  } finally {
    session.endSession();
  }
}

async function releaseHeldFundsForNativePrivateEvent({
  event,
  session,
  now = new Date(),
  reason = "AUTO_RELEASE_AFTER_24H",
}) {
  const ps = event?.privateSession || null;

  if (!event || !ps?.roomId) {
    return {
      releasedCount: 0,
      releasedTokens: 0,
      releasedToRedeemable: 0,
      releasedToEarnings: 0,
    };
  }

  const activeTickets = await Ticket.find({
    eventId: event._id,
    scope: "private",
    roomId: ps.roomId,
    status: "active",
  }).session(session);

  if (!activeTickets.length) {
    return {
      releasedCount: 0,
      releasedTokens: 0,
      releasedToRedeemable: 0,
      releasedToEarnings: 0,
    };
  }

  const creator = await User.findById(event.creatorId)
    .select("_id accountType isCreator creatorEnabled creatorVerification tokenHeld tokenRedeemable tokenEarnings")
    .session(session);

  if (!creator) {
    const err = new Error("Creator not found");
    err.httpStatus = 404;
    err.payload = { status: "error", message: "Creator not found" };
    throw err;
  }

  let releasedCount = 0;
  let releasedTokens = 0;
  let releasedToRedeemable = 0;
  let releasedToEarnings = 0;

  for (const ticket of activeTickets) {
    const amount = Number(ticket.priceTokens || 0);
    if (!(amount > 0)) continue;

    const opId = `privrelease_${String(ticket._id)}`;

    const existingRelease = await TokenTransaction.findOne({
      opId,
      kind: "private_release",
      direction: "credit",
      fromUserId: creator._id,
      toUserId: creator._id,
      eventId: event._id,
      scope: "private",
      roomId: ticket.roomId || null,
    }).session(session);

    if (existingRelease) continue;

    const origDebit = await TokenTransaction.findOne({
      kind: "ticket_purchase",
      direction: "debit",
      eventId: event._id,
      scope: "private",
      roomId: ticket.roomId || null,
      fromUserId: ticket.userId,
      toUserId: creator._id,
      amountTokens: amount,
    })
      .sort({ createdAt: -1 })
      .session(session);

    const releaseTargetBucketRaw = String(origDebit?.metadata?.releaseTargetBucket || "").trim().toLowerCase();
    const fallbackReleaseBucket = isCreatorEligibleForRedeemableBucket(creator) ? "redeemable" : "earnings";

    const releaseTargetBucket =
      releaseTargetBucketRaw === "redeemable" || releaseTargetBucketRaw === "earnings"
        ? releaseTargetBucketRaw
        : fallbackReleaseBucket;

    const creatorInc =
      releaseTargetBucket === "redeemable"
        ? { tokenHeld: -amount, tokenRedeemable: amount }
        : { tokenHeld: -amount, tokenEarnings: amount };

    const releaseUpdate = await User.updateOne(
      { _id: creator._id, tokenHeld: { $gte: amount } },
      { $inc: creatorInc },
      { session }
    );

    if (releaseUpdate.modifiedCount !== 1) {
      const err = new Error("INSUFFICIENT_HELD_FOR_RELEASE");
      err.httpStatus = 409;
      err.payload = {
        status: "error",
        code: "INSUFFICIENT_HELD_FOR_RELEASE",
        message: "Private funds cannot be released due to inconsistent held balance",
      };
      throw err;
    }

    const groupId = `grp_${crypto.randomUUID()}`;

    await TokenTransaction.insertMany(
      [
        {
          opId,
          groupId,
          fromUserId: creator._id,
          toUserId: creator._id,
          kind: "private_release",
          direction: "debit",
          context: "ticket",
          contextId: String(event._id),
          amountTokens: amount,
          amountEuro: 0,
          eventId: event._id,
          scope: "private",
          roomId: ticket.roomId || null,
          metadata: {
            fromBucket: "held",
            toBucket: releaseTargetBucket,
            originalTicketId: ticket._id,
            originalOpId: origDebit?.opId || null,
            reason,
            autoRelease: true,
            releasedAt: now,
          },
        },
        {
          opId,
          groupId,
          fromUserId: creator._id,
          toUserId: creator._id,
          kind: "private_release",
          direction: "credit",
          context: "ticket",
          contextId: String(event._id),
          amountTokens: amount,
          amountEuro: 0,
          eventId: event._id,
          scope: "private",
          roomId: ticket.roomId || null,
          metadata: {
            fromBucket: "held",
            toBucket: releaseTargetBucket,
            originalTicketId: ticket._id,
            originalOpId: origDebit?.opId || null,
            reason,
            autoRelease: true,
            releasedAt: now,
          },
        },
      ],
      { session, ordered: true }
    );

    releasedCount += 1;
    releasedTokens += amount;
    if (releaseTargetBucket === "redeemable") releasedToRedeemable += amount;
    else releasedToEarnings += amount;
  }

  return {
    releasedCount,
    releasedTokens,
    releasedToRedeemable,
    releasedToEarnings,
  };
}

async function processOneEligibleNativePrivateRelease({ eventId, now = new Date() }) {
  const mongoose = require("mongoose");
  const session = await mongoose.startSession();

  try {
    let result = {
      processed: false,
      releasedCount: 0,
      releasedTokens: 0,
      releasedToRedeemable: 0,
      releasedToEarnings: 0,
    };

    await session.withTransaction(async () => {
      const event = await Event.findOne({
        _id: eventId,
        accessScope: "private",
        status: "finished",
        "privateSession.economicStatus": "held",
        "privateSession.economicReleaseEligibleAt": { $lte: now },
      }).session(session);

      if (!event) return;

      const releaseResult = await releaseHeldFundsForNativePrivateEvent({
        event,
        session,
        now,
        reason: "AUTO_RELEASE_AFTER_24H",
      });

      event.privateSession.economicStatus = "released";
      event.privateSession.economicReleasedAt = now;
      event.privateSession.economicFrozenAt = null;
      event.privateSession.economicRefundedAt = null;
      event.privateSession.economicResolutionReason = "AUTO_RELEASE_AFTER_24H";
      event.privateSession.economicHeldTokens = 0;

      await event.save({ session });

      result = {
        processed: true,
        ...releaseResult,
      };
    });

    return result;
  } finally {
    session.endSession();
  }
}

async function refundNativePrivateHeldOrFrozenEvent({
  eventId,
  adminId = null,
  now = new Date(),
  reason = "ADMIN_REFUND",
}) {
  const mongoose = require("mongoose");
  const session = await mongoose.startSession();

  try {
    let result = {
      processed: false,
      alreadyRefunded: false,
      eventId: String(eventId || ""),
      statusBefore: null,
      statusAfter: null,
      refundedCount: 0,
      refundedTokens: 0,
    };

    await session.withTransaction(async () => {
      const event = await Event.findOne({
        _id: eventId,
        accessScope: "private",
        status: "finished",
      }).session(session);

      if (!event) {
        const err = new Error("EVENT_NOT_FOUND");
        err.httpStatus = 404;
        err.payload = {
          status: "error",
          code: "EVENT_NOT_FOUND",
          message: "Event not found",
        };
        throw err;
      }

      const currentEconomicStatus = String(event?.privateSession?.economicStatus || "none").trim().toLowerCase();
      result.statusBefore = currentEconomicStatus;

      if (currentEconomicStatus === "refunded") {
        result.processed = true;
        result.alreadyRefunded = true;
        result.statusAfter = "refunded";
        return;
      }

      if (!["held", "frozen"].includes(currentEconomicStatus)) {
        const err = new Error("PRIVATE_FUNDS_NOT_REFUNDABLE");
        err.httpStatus = 409;
        err.payload = {
          status: "error",
          code: "PRIVATE_FUNDS_NOT_REFUNDABLE",
          message: "Only held or frozen native private funds can be refunded",
          data: {
            economicStatus: currentEconomicStatus,
          },
        };
        throw err;
      }

      const ps = event.privateSession || null;
      if (!ps?.roomId) {
        const err = new Error("PRIVATE_ROOM_NOT_FOUND");
        err.httpStatus = 409;
        err.payload = {
          status: "error",
          code: "PRIVATE_ROOM_NOT_FOUND",
          message: "Native private room not found",
        };
        throw err;
      }

      const activeTickets = await Ticket.find({
        eventId: event._id,
        scope: "private",
        roomId: ps.roomId,
        status: { $in: ["active", "refunded"] },
      }).session(session);

      let refundedCount = 0;
      let refundedTokens = 0;

      for (const ticket of activeTickets) {
        const buyerId = ticket.userId;
        const creatorId = event.creatorId;
        const amount = Number(ticket.priceTokens || 0);

        const refundOpId = `admin_privrefund_${String(ticket._id)}`;

        const existingRefund = await TokenTransaction.findOne({
          opId: refundOpId,
          kind: "ticket_refund",
          direction: "credit",
          fromUserId: creatorId,
          toUserId: buyerId,
          eventId: event._id,
          scope: "private",
          roomId: ticket.roomId || null,
        }).session(session);

        const alreadyRefundedByTicket = String(ticket.status) === "refunded";
        const alreadyRefunded = alreadyRefundedByTicket || !!existingRefund;

        if (alreadyRefunded) continue;
        if (!(amount > 0)) {
          ticket.status = "refunded";
          ticket.refundedAt = now;
          await ticket.save({ session });
          continue;
        }

        const origDebit = await TokenTransaction.findOne({
          $or: [
            {
              kind: "ticket_purchase",
              direction: "debit",
              eventId: event._id,
              scope: "private",
              roomId: ticket.roomId || null,
              fromUserId: buyerId,
              toUserId: creatorId,
              amountTokens: amount,
            },
            {
              kind: "private_purchase",
              direction: "debit",
              eventId: event._id,
              scope: "private",
              roomId: ticket.roomId || null,
              fromUserId: buyerId,
              toUserId: creatorId,
              amountTokens: amount,
            },
          ],
        })
          .sort({ createdAt: -1 })
          .session(session);

        const buyerBuckets = (origDebit?.metadata && origDebit.metadata.buyerBuckets) || null;
        const usedFromEarnings = Number(buyerBuckets?.earnings || 0);
        const usedFromRedeemable = Number(buyerBuckets?.redeemable || 0);

        const incBuyer = { tokenBalance: amount };
        if (usedFromEarnings > 0) incBuyer.tokenEarnings = usedFromEarnings;
        if (usedFromRedeemable > 0) incBuyer.tokenRedeemable = usedFromRedeemable;

        await User.updateOne(
          { _id: buyerId },
          { $inc: incBuyer },
          { session }
        );

        const decCreator = { tokenBalance: -amount, tokenHeld: -amount };

        const creatorUpdate = await User.updateOne(
          { _id: creatorId, tokenHeld: { $gte: amount } },
          { $inc: decCreator },
          { session }
        );

        if (creatorUpdate.modifiedCount !== 1) {
          const err = new Error("INSUFFICIENT_HELD_FOR_REFUND");
          err.httpStatus = 409;
          err.payload = {
            status: "error",
            code: "INSUFFICIENT_HELD_FOR_REFUND",
            message: "Private funds cannot be refunded due to inconsistent held balance",
          };
          throw err;
        }

        const groupId = `grp_${crypto.randomUUID()}`;

        await TokenTransaction.insertMany(
          [
            {
              opId: refundOpId,
              groupId,
              fromUserId: creatorId,
              toUserId: buyerId,
              kind: "ticket_refund",
              direction: "credit",
              context: "ticket",
              contextId: String(event._id),
              amountTokens: amount,
              amountEuro: 0,
              eventId: event._id,
              scope: "private",
              roomId: ticket.roomId || null,
              metadata: {
                reason,
                originalTicketId: ticket._id,
                originalOpId: origDebit?.opId || null,
                buyerBuckets: {
                  earnings: usedFromEarnings,
                  redeemable: usedFromRedeemable,
                },
                creatorBucket: "held",
                adminRefund: true,
                refundedAt: now,
              },
            },
            {
              opId: refundOpId,
              groupId,
              fromUserId: creatorId,
              toUserId: buyerId,
              kind: "ticket_refund",
              direction: "debit",
              context: "ticket",
              contextId: String(event._id),
              amountTokens: amount,
              amountEuro: 0,
              eventId: event._id,
              scope: "private",
              roomId: ticket.roomId || null,
              metadata: {
                reason,
                originalTicketId: ticket._id,
                originalOpId: origDebit?.opId || null,
                adminRefund: true,
                refundedAt: now,
              },
            },
          ],
          { session, ordered: true }
        );

        ticket.status = "refunded";
        ticket.refundedAt = now;
        await ticket.save({ session });

        refundedCount += 1;
        refundedTokens += amount;
      }

      if (!event.privateSession) event.privateSession = {};

      event.privateSession.economicStatus = "refunded";
      event.privateSession.economicRefundedAt = now;
      event.privateSession.economicResolutionReason = reason;
      event.privateSession.economicHeldTokens = 0;

      await event.save({ session });

      result.processed = true;
      result.alreadyRefunded = false;
      result.statusAfter = "refunded";
      result.refundedCount = refundedCount;
      result.refundedTokens = refundedTokens;
    });

    return result;
  } finally {
    session.endSession();
  }
}

module.exports = {
  releaseHeldFundsForNativePrivateEvent,
  processOneEligibleNativePrivateRelease,
  freezeNativePrivateHeldEvent,
  refundNativePrivateHeldOrFrozenEvent,
};