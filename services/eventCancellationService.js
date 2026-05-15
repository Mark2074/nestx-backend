const crypto = require("crypto");
const mongoose = require("mongoose");

const Adv = require("../models/adv");
const Event = require("../models/event");
const Notification = require("../models/notification");
const Ticket = require("../models/ticket");
const TokenTransaction = require("../models/tokenTransaction");
const User = require("../models/user");
const { resetRuntimeForScope } = require("./liveRuntimeService");

function isNativePrivateEvent(event) {
  return String(event?.accessScope || "public").trim().toLowerCase() === "private";
}

function makeHttpError(status, payload) {
  const err = new Error(payload?.message || "Event cancellation failed");
  err.httpStatus = status;
  err.payload = payload;
  return err;
}

async function cancelScheduledEventWithRefund({
  eventId,
  requireCreatorId = null,
  reason = "EVENT_CANCELLED",
} = {}) {
  if (!eventId || !mongoose.Types.ObjectId.isValid(String(eventId))) {
    throw makeHttpError(400, {
      status: "error",
      message: "Invalid event ID",
    });
  }

  const event = await Event.findById(eventId).exec();

  if (!event) {
    throw makeHttpError(404, {
      status: "error",
      message: "Event not found",
    });
  }

  if (requireCreatorId && String(event.creatorId) !== String(requireCreatorId)) {
    throw makeHttpError(403, {
      status: "error",
      message: "Only host of the event can cancel it",
    });
  }

  if (event.status === "cancelled") {
    return {
      eventId: event._id,
      status: event.status,
      alreadyCancelled: true,
      refundedUsersCount: 0,
      totalRefundedTokens: 0,
    };
  }

  if (event.status !== "scheduled") {
    throw makeHttpError(400, {
      status: "error",
      message: "You can't cancel an event that has already started or ended. Use finish to close it.",
      data: {
        eventId: event._id,
        status: event.status,
      },
    });
  }

  const session = await mongoose.startSession();

  let activeTickets = [];
  let refundMap = new Map();
  let totalRefundedTokens = 0;
  let refundedUsersCount = 0;
  let cancelledEvent = event;

  try {
    await session.withTransaction(async () => {
      const eventTx = await Event.findById(eventId).session(session).exec();

      if (!eventTx) {
        throw makeHttpError(404, {
          status: "error",
          message: "Event not found",
        });
      }

      if (eventTx.status === "cancelled") {
        cancelledEvent = eventTx;
        return;
      }

      if (eventTx.status !== "scheduled") {
        throw makeHttpError(400, {
          status: "error",
          message: "You can't cancel an event that has already started or ended. Use finish to close it.",
          data: { eventId: eventTx._id, status: eventTx.status },
        });
      }

      activeTickets = await Ticket.find({ eventId: eventTx._id, status: "active" })
        .session(session)
        .exec();

      if (activeTickets.length === 0) {
        eventTx.status = "cancelled";
        eventTx.totalTokensEarned = 0;
        eventTx.creatorShareTokens = 0;
        eventTx.platformShareTokens = 0;
        await eventTx.save({ session });

        refundedUsersCount = 0;
        totalRefundedTokens = 0;
        refundMap = new Map();
        cancelledEvent = eventTx;
        return;
      }

      refundMap = new Map();
      totalRefundedTokens = 0;

      for (const ticket of activeTickets) {
        const userIdStr = ticket.userId.toString();
        const amount = Number(ticket.priceTokens) || 0;
        const prev = refundMap.get(userIdStr) || 0;
        refundMap.set(userIdStr, prev + amount);
        totalRefundedTokens += amount;
      }

      refundedUsersCount = Array.from(refundMap.keys()).length;

      const now = new Date();

      for (const ticket of activeTickets) {
        const buyerId = ticket.userId;
        const creatorId = eventTx.creatorId;
        const amount = Number(ticket.priceTokens || 0);

        if (!(amount > 0)) {
          ticket.status = "refunded";
          ticket.refundedAt = now;
          await ticket.save({ session });
          continue;
        }

        const ticketScope = String(ticket.scope || "public");
        const ticketRoomId = ticket.roomId || null;
        const refundOpId = `refund_${String(ticket._id)}`;

        const existingRefund = await TokenTransaction.findOne({
          opId: refundOpId,
          kind: "ticket_refund",
          direction: "credit",
          fromUserId: creatorId,
          toUserId: buyerId,
          eventId: eventTx._id,
          scope: ticketScope,
          roomId: ticketRoomId,
        }).session(session);

        const alreadyRefundedByTicket = String(ticket.status) === "refunded";
        const alreadyRefunded = alreadyRefundedByTicket || !!existingRefund;

        if (!alreadyRefunded) {
          const origDebit = await TokenTransaction.findOne({
            kind: "ticket_purchase",
            direction: "debit",
            eventId: eventTx._id,
            scope: ticketScope,
            roomId: ticketRoomId,
            fromUserId: buyerId,
            toUserId: creatorId,
            amountTokens: amount,
          })
            .sort({ createdAt: -1 })
            .session(session);

          const buyerBuckets = (origDebit?.metadata && origDebit.metadata.buyerBuckets) || null;
          const usedFromEarnings = Number(buyerBuckets?.earnings || 0);
          const usedFromRedeemable = Number(buyerBuckets?.redeemable || 0);

          const creatorBucketRaw = String(origDebit?.metadata?.creatorBucket || "").trim().toLowerCase();

          let creatorBucket = "earnings";
          if (creatorBucketRaw === "redeemable") creatorBucket = "redeemable";
          else if (creatorBucketRaw === "held") creatorBucket = "held";

          const incBuyer = { tokenBalance: amount };
          if (usedFromEarnings > 0) incBuyer.tokenEarnings = usedFromEarnings;
          if (usedFromRedeemable > 0) incBuyer.tokenRedeemable = usedFromRedeemable;

          await User.updateOne(
            { _id: buyerId },
            { $inc: incBuyer },
            { session }
          );

          const decCreator = { tokenBalance: -amount };
          if (creatorBucket === "redeemable") decCreator.tokenRedeemable = -amount;
          else if (creatorBucket === "held") decCreator.tokenHeld = -amount;
          else decCreator.tokenEarnings = -amount;

          await User.updateOne(
            { _id: creatorId },
            { $inc: decCreator },
            { session }
          );

          const refundGroupId = `grp_${crypto.randomUUID()}`;

          await TokenTransaction.insertMany(
            [
              {
                opId: refundOpId,
                groupId: refundGroupId,
                fromUserId: creatorId,
                toUserId: buyerId,
                kind: "ticket_refund",
                direction: "credit",
                context: "ticket",
                contextId: String(eventTx._id),
                amountTokens: amount,
                amountEuro: 0,
                eventId: eventTx._id,
                scope: ticketScope,
                roomId: ticketRoomId,
                metadata: {
                  reason,
                  originalTicketId: ticket._id,
                  originalOpId: origDebit?.opId || null,
                  buyerBuckets: {
                    earnings: usedFromEarnings,
                    redeemable: usedFromRedeemable,
                  },
                  creatorBucket,
                },
              },
              {
                opId: refundOpId,
                groupId: refundGroupId,
                fromUserId: creatorId,
                toUserId: buyerId,
                kind: "ticket_refund",
                direction: "debit",
                context: "ticket",
                contextId: String(eventTx._id),
                amountTokens: amount,
                amountEuro: 0,
                eventId: eventTx._id,
                scope: ticketScope,
                roomId: ticketRoomId,
                metadata: {
                  reason,
                  originalTicketId: ticket._id,
                  originalOpId: origDebit?.opId || null,
                },
              },
            ],
            { session, ordered: true }
          );
        }

        ticket.status = "refunded";
        ticket.refundedAt = now;
        await ticket.save({ session });
      }

      eventTx.status = "cancelled";
      eventTx.totalTokensEarned = 0;
      eventTx.creatorShareTokens = 0;
      eventTx.platformShareTokens = 0;

      if (isNativePrivateEvent(eventTx)) {
        if (!eventTx.privateSession) eventTx.privateSession = {};
        eventTx.privateSession.economicStatus = "refunded";
        eventTx.privateSession.economicHeldTokens = 0;
        eventTx.privateSession.economicRefundedAt = now;
        eventTx.privateSession.economicResolutionReason = reason;
      }

      await eventTx.save({ session });
      cancelledEvent = eventTx;
    });
  } finally {
    session.endSession();
  }

  try {
    await resetRuntimeForScope({
      eventId: event._id,
      scope: "public",
      endedAt: new Date(),
      roomStatus: "ended",
      clearPresence: true,
      privateSessionCounter: null,
    });

    const privateCounter = Number(event?.privateSessionCounter || 0);

    if (event?.privateSession?.roomId || event?.accessScope === "private") {
      await resetRuntimeForScope({
        eventId: event._id,
        scope: "private",
        endedAt: new Date(),
        roomStatus: "ended",
        clearPresence: true,
        privateSessionCounter: privateCounter,
      });
    }
  } catch (e) {
    console.error("RESET_RUNTIME_ON_CANCEL_FAILED", e?.message || e);
  }

  try {
    await Adv.updateMany(
      { targetType: "event", targetId: event._id, isActive: true },
      { $set: { isActive: false } }
    );
  } catch (e) {
    console.error("ADV_DISABLE_ON_CANCEL_FAILED", e?.message || e);
  }

  try {
    const userIds = Array.from(refundMap.keys());

    for (const uid of userIds) {
      const refundAmount = refundMap.get(uid) || 0;
      if (!refundAmount) continue;

      const dedupeKey = `ticket_refunded:${event._id.toString()}:${uid}`;

      await Notification.updateOne(
        { dedupeKey },
        {
          $setOnInsert: {
            userId: uid,
            actorId: event.creatorId,
            type: "TICKET_REFUNDED",
            targetType: "event",
            targetId: event._id,
            message: `Ticket refund: +${refundAmount} tokens`,
            isPersistent: true,
            data: {
              eventId: event._id,
              amountTokens: refundAmount,
              refundedAt: new Date(),
            },
            dedupeKey,
          },
        },
        { upsert: true }
      );
    }
  } catch (e) {
    console.error("REFUND_NOTIFICATIONS_FAILED", e?.message || e);
  }

  try {
    if (activeTickets.length > 0) {
      const uniqueUserIds = Array.from(
        new Set(activeTickets.map((t) => t.userId?.toString()).filter(Boolean))
      );

      if (uniqueUserIds.length > 0) {
        const notifOps = uniqueUserIds.map((uid) => ({
          updateOne: {
            filter: { dedupeKey: `event_cancelled:${event._id.toString()}:${uid}` },
            update: {
              $setOnInsert: {
                userId: uid,
                actorId: event.creatorId,
                type: "EVENT_CANCELLED",
                targetType: "event",
                targetId: event._id,
                message: "An event you have a ticket for has been cancelled",
                isPersistent: false,
                data: {
                  eventId: event._id,
                  cancelledAt: new Date(),
                },
                dedupeKey: `event_cancelled:${event._id.toString()}:${uid}`,
              },
            },
            upsert: true,
          },
        }));

        await Notification.bulkWrite(notifOps, { ordered: false });
      }
    }
  } catch (e) {
    console.error("NOTIFICATION_EVENT_CANCELLED_FAILED", e?.message || e);
  }

  return {
    eventId: event._id,
    status: cancelledEvent?.status || "cancelled",
    alreadyCancelled: false,
    refundedUsersCount,
    totalRefundedTokens,
  };
}

async function cancelScheduledEventsForCreator({
  creatorId,
  reason = "CREATOR_DISABLED",
} = {}) {
  if (!creatorId || !mongoose.Types.ObjectId.isValid(String(creatorId))) {
    return { attempted: 0, cancelled: 0, failed: 0, results: [] };
  }

  const events = await Event.find({
    creatorId,
    status: "scheduled",
  })
    .select("_id")
    .lean();

  const results = [];

  for (const event of events) {
    try {
      const result = await cancelScheduledEventWithRefund({
        eventId: event._id,
        reason,
      });

      results.push({
        eventId: String(event._id),
        status: "cancelled",
        refundedUsersCount: result.refundedUsersCount,
        totalRefundedTokens: result.totalRefundedTokens,
      });
    } catch (err) {
      console.error("CREATOR_EVENT_CANCEL_FAILED", {
        creatorId: String(creatorId),
        eventId: String(event._id),
        message: err?.message || err,
      });

      results.push({
        eventId: String(event._id),
        status: "failed",
        message: err?.payload?.message || err?.message || "Cancellation failed",
      });
    }
  }

  const cancelled = results.filter((item) => item.status === "cancelled").length;
  const failed = results.filter((item) => item.status === "failed").length;

  return {
    attempted: events.length,
    cancelled,
    failed,
    results,
  };
}

module.exports = {
  cancelScheduledEventWithRefund,
  cancelScheduledEventsForCreator,
};
