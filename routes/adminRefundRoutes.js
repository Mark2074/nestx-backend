// routes/adminRefundRoutes.js
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");

const auth = require("../middleware/authMiddleware"); // o authMiddleware, usa lo stesso che usi altrove

const User = require("../models/user");
const Ticket = require("../models/ticket");
const Event = require("../models/event");
const LivePresence = require("../models/LivePresence"); // attenzione: nome file/model come lo hai tu
const TokenTransaction = require("../models/tokenTransaction");
const Notification = require("../models/notification");
const adminGuard = require("../middleware/adminGuard");

const router = express.Router();

// helper: minuti tra 2 date
function diffMinutes(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

// --------------------------------------------------
// GET /api/admin/refund-check/:ticketId
// Ritorna una “foto” unica per decidere il rimborso
// --------------------------------------------------
router.get("/refund-check/:ticketId", auth, adminGuard, async (req, res) => {
  try {
    const { ticketId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ status: "error", message: "Invalid ticket ID" });
    }

    const ticket = await Ticket.findById(ticketId).lean();
    if (!ticket) {
      return res.status(404).json({ status: "error", message: "Ticket not found" });
    }

    const event = await Event.findById(ticket.eventId).lean();
    if (!event) {
      return res.status(404).json({ status: "error", message: "Event not found (orphaned ticket?)" });
    }

    // LivePresence (se esiste)
    // NB: il tuo schema ha index {eventId, scope, userId} (quindi una row per scope)
    const presenceQuery = {
      eventId: ticket.eventId,
      scope: ticket.scope || "public",
      userId: ticket.userId,
    };
    const presence = await LivePresence.findOne(presenceQuery).lean();

    // calcolo “tempo effettivo”
    const joinedAt = presence?.joinedAt || null;
    const leftAt = presence?.leftAt || null;
    const effectiveMinutes = joinedAt
      ? diffMinutes(joinedAt, leftAt || new Date())
      : 0;

    // TokenTransaction di acquisto (gestisce sia schema nuovo che vecchio)
    // - nuovo: kind="ticket_purchase"
    // - vecchio: metadata.kind="ticket_purchase"
    const tx = await TokenTransaction.findOne({
      $or: [
        { kind: "ticket_purchase" },
        { "metadata.kind": "ticket_purchase" },
      ],
      eventId: ticket.eventId,
      fromUserId: ticket.userId,
      scope: ticket.scope || null,
      roomId: ticket.roomId || null,
      amountTokens: ticket.priceTokens,
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      status: "ok",
      data: {
        ticket: {
          _id: ticket._id,
          eventId: ticket.eventId,
          userId: ticket.userId,
          status: ticket.status,
          scope: ticket.scope,
          roomId: ticket.roomId,
          priceTokens: ticket.priceTokens,
          purchasedAt: ticket.purchasedAt,
          refundedAt: ticket.refundedAt || null,
        },
        event: {
          _id: event._id,
          creatorId: event.creatorId,
          title: event.title,
          status: event.status,
          visibility: event.visibility,
          accessScope: event.accessScope,
          startedAt: event.startedAt || null,
          endedAt: event.endedAt || null,
          actualLiveStartTime: event.actualLiveStartTime || null,
          actualLiveEndTime: event.actualLiveEndTime || null,
          privateSession: event.privateSession || null,
        },
        livePresence: presence
          ? {
              status: presence.status || null,
              roomId: presence.roomId || null,
              joinedAt,
              leftAt,
              effectiveMinutes,
            }
          : {
              joinedAt: null,
              leftAt: null,
              effectiveMinutes: 0,
            },
        purchaseTx: tx || null,
        hints: {
          // zero logica “di decisione” qui: solo supporto admin
          canAutoRefundSuggestion: effectiveMinutes === 0, // esempio: mai entrato
        },
      },
    });
  } catch (err) {
    console.error("Admin refund-check error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

async function adminRefundTicketById({ ticketId, adminId, note }) {
  const session = await mongoose.startSession();

  try {
    const safeTicketId = String(ticketId || "").trim();
    const safeNote = String(note || "").trim();

    if (!mongoose.Types.ObjectId.isValid(safeTicketId)) {
      const err = new Error("Invalid ticket ID");
      err.statusCode = 400;
      throw err;
    }

    let ticket = await Ticket.findById(safeTicketId).session(session);
    if (!ticket) {
      const err = new Error("Ticket not found");
      err.statusCode = 404;
      throw err;
    }

    if (ticket.status === "refunded") {
      return {
        ticketId: ticket._id,
        userId: ticket.userId,
        eventId: ticket.eventId,
        amountTokens: Number(ticket.priceTokens || 0),
        refundedAt: ticket.refundedAt || null,
        alreadyRefunded: true,
      };
    }

    const event = await Event.findById(ticket.eventId).session(session);
    if (!event) {
      const err = new Error("Event not found (orphaned ticket?)");
      err.statusCode = 404;
      throw err;
    }

    const amountTokens = Number(ticket.priceTokens || 0);
    if (!Number.isFinite(amountTokens) || amountTokens <= 0) {
      const err = new Error("Ticket not refundable: priceTokens invalid");
      err.statusCode = 400;
      throw err;
    }

    await session.withTransaction(async () => {
      const buyerId = ticket.userId;
      const creatorId = event.creatorId;
      const ticketScope = String(ticket.scope || "public");
      const ticketRoomId = ticket.roomId || null;
      const refundOpId = `admin_ticket_refund:${String(ticket._id)}`;

      const existingRefund = await TokenTransaction.findOne({
        opId: refundOpId,
        kind: "ticket_refund",
        direction: "credit",
        fromUserId: creatorId,
        toUserId: buyerId,
        eventId: event._id,
        scope: ticketScope,
        roomId: ticketRoomId,
      }).session(session);

      const alreadyRefundedByTicket = String(ticket.status) === "refunded";
      const alreadyRefunded = alreadyRefundedByTicket || !!existingRefund;

      if (alreadyRefunded) {
        if (!alreadyRefundedByTicket) {
          ticket.status = "refunded";
          ticket.refundedAt = new Date();
          await ticket.save({ session });
        }
        return;
      }

      const origDebit = await TokenTransaction.findOne({
        kind: "ticket_purchase",
        direction: "debit",
        eventId: event._id,
        scope: ticketScope,
        roomId: ticketRoomId,
        fromUserId: buyerId,
        toUserId: creatorId,
        amountTokens,
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

      const incBuyer = { tokenBalance: amountTokens };
      if (usedFromEarnings > 0) incBuyer.tokenEarnings = usedFromEarnings;
      if (usedFromRedeemable > 0) incBuyer.tokenRedeemable = usedFromRedeemable;

      await User.updateOne(
        { _id: buyerId },
        { $inc: incBuyer },
        { session }
      );

      const decCreator = { tokenBalance: -amountTokens };
      if (creatorBucket === "redeemable") decCreator.tokenRedeemable = -amountTokens;
      else if (creatorBucket === "held") decCreator.tokenHeld = -amountTokens;
      else decCreator.tokenEarnings = -amountTokens;

      await User.updateOne(
        { _id: creatorId },
        { $inc: decCreator },
        { session }
      );

      const refundGroupId = `grp_${crypto.randomUUID()}`;
      const refundedAt = new Date();

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
            contextId: String(event._id),
            amountTokens,
            amountEuro: 0,
            eventId: event._id,
            scope: ticketScope,
            roomId: ticketRoomId,
            metadata: {
              reason: "ADMIN_REFUND",
              originalTicketId: ticket._id,
              originalOpId: origDebit?.opId || null,
              buyerBuckets: {
                earnings: usedFromEarnings,
                redeemable: usedFromRedeemable,
              },
              creatorBucket,
              adminNote: safeNote || null,
              refundedAt,
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
            contextId: String(event._id),
            amountTokens,
            amountEuro: 0,
            eventId: event._id,
            scope: ticketScope,
            roomId: ticketRoomId,
            metadata: {
              reason: "ADMIN_REFUND",
              originalTicketId: ticket._id,
              originalOpId: origDebit?.opId || null,
              adminNote: safeNote || null,
              refundedAt,
            },
          },
        ],
        { session, ordered: true }
      );

      await Notification.create(
        [
          {
            userId: buyerId,
            actorId: adminId || null,
            type: "TICKET_REFUNDED",
            targetType: "ticket",
            targetId: ticket._id,
            message: "Ticket refund made.",
            data: {
              ticketId: ticket._id.toString(),
              eventId: event._id.toString(),
              amountTokens,
              scope: ticketScope,
              roomId: ticketRoomId,
              adminNote: safeNote || null,
            },
            isPersistent: true,
          },
          {
            userId: creatorId,
            actorId: adminId || null,
            type: "TICKET_REFUNDED",
            targetType: "event",
            targetId: event._id,
            message: "A ticket refund was made on your event.",
            data: {
              ticketId: ticket._id.toString(),
              eventId: event._id.toString(),
              refundedUserId: buyerId.toString(),
              amountTokens,
              scope: ticketScope,
              roomId: ticketRoomId,
              adminNote: safeNote || null,
            },
            isPersistent: true,
          },
        ],
        { session, ordered: true }
      );

      ticket.status = "refunded";
      ticket.refundedAt = refundedAt;
      await ticket.save({ session });
    });

    return {
      ticketId: ticket._id,
      userId: ticket.userId,
      eventId: ticket.eventId,
      amountTokens,
      refundedAt: ticket.refundedAt,
      alreadyRefunded: false,
    };
  } finally {
    session.endSession().catch(() => {});
  }
}

// --------------------------------------------------
// POST /api/admin/refund/:ticketId
// Esegue rimborso token + TokenTransaction kind=ticket_refund + ticket.status=refunded
// --------------------------------------------------
router.post("/refund/:ticketId", auth, adminGuard, async (req, res) => {
  try {
    const result = await adminRefundTicketById({
      ticketId: req.params.ticketId,
      adminId: req.user._id,
      note: req.body?.note,
    });

    return res.json({
      status: "ok",
      message: result?.alreadyRefunded ? "Ticket already refunded" : "Refund executed",
      data: result,
    });
  } catch (err) {
    console.error("Admin refund error:", err);
    return res.status(err.statusCode || 500).json({
      status: "error",
      message: err.message || "Internal error",
    });
  }
});

module.exports = {
  router,
  adminRefundTicketById,
};
