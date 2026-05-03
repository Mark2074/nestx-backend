// routes/eventRoutes.js

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Event = require("../models/event");
const User = require("../models/user");
const auth = require("../middleware/authMiddleware");
const featureGuard = require("../middleware/featureGuard");
const Ticket = require("../models/ticket");
const { isUserBlockedEitherSide } = require("../utils/blockUtils");
const LiveRoom = require("../models/LiveRoom");
const TokenTransaction = require("../models/tokenTransaction");
const getMutedUserIds = require("../utils/getMutedUserIds");
const Notification = require("../models/notification");
const Follow = require("../models/Follow"); // per follower dell'host (status: accepted)
const { getBlockedUserIds } = require("../utils/blockUtils");
const { checkEventAccess } = require("../services/eventAccessService");
const crypto = require("crypto");
const { debitUserTokensBuckets } = require("../services/tokenDebitService");
const Adv = require("../models/adv");
const { detectContentSafety } = require("../utils/contentSafety");
const { resetRuntimeForScope } = require("../services/liveRuntimeService");
const { chargeUserToCreator } = require("../services/livePaymentService");

router.get('/ping-events', (req, res) => {
  res.json({ status: 'ok', source: 'eventRoutes' });
});

// Helper: prende il tipo account dal req.user, compatibile con role/accountType
function getAccountTypeFromUser(user) {
  if (!user) return null;
  // se hai accountType usiamo quello, altrimenti fallback su role
  return user.accountType || user.role || null;
}

function parseBool(v) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

function tokensRuntimeEnabled() {
  const economyEnabled = parseBool(process.env.ECONOMY_ENABLED);
  const tokensEnabled = economyEnabled && parseBool(process.env.TOKENS_ENABLED ?? "true");
  return tokensEnabled;
}

function logPrivateFlow(stage, payload = {}) {
  try {
    console.log(
      `[PRIVATE][${stage}]`,
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      })
    );
  } catch {
    console.log(`[PRIVATE][${stage}]`, payload);
  }
}

function logTicketFlow(stage, payload = {}) {
  try {
    console.log(
      `[TICKET][${stage}]`,
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      })
    );
  } catch {
    console.log(`[TICKET][${stage}]`, payload);
  }
}

// =========================
// NOTIFICHE EVENTO (v1)
// =========================

// crea 1 notifica per ogni destinatario con dedupe per-user
async function createNotifForUsers({ userIds, actorId, type, targetType, targetId, message, data, dedupeBase }) {
  if (!Array.isArray(userIds) || userIds.length === 0) return;

  const unique = Array.from(new Set(userIds.map((x) => x?.toString()).filter(Boolean)));

  // BEST-EFFORT: non bloccare mai il flow evento
  try {
    await Promise.all(
      unique.map((uid) => {
        const dedupeKey = `${dedupeBase}:${uid}`;

        return Notification.updateOne(
          { dedupeKey },
          {
            $setOnInsert: {
              userId: uid,
              actorId: actorId || null,
              type,
              targetType,
              targetId,
              message: message || "",
              isPersistent: false,
              data: data || {},
              dedupeKey,
            },
          },
          { upsert: true }
        );
      })
    );
  } catch (e) {
    console.error("EVENT_NOTIF_CREATE_FAILED", e?.message || e);
  }
}

// destinatari: ticket holders PUBLIC (active)
async function getPublicTicketUserIds(eventId) {
  return Ticket.distinct("userId", { eventId, status: "active", scope: "public" });
}

// destinatari: ticket holders PRIVATE per roomId (active)
async function getPrivateTicketUserIds(eventId, roomId) {
  return Ticket.distinct("userId", { eventId, status: "active", scope: "private", roomId });
}

// destinatari: ticket holders TUTTI (public+private) (active)
async function getAllTicketUserIds(eventId) {
  return Ticket.distinct("userId", { eventId, status: "active" });
}

// follower dell'host: accepted
async function getAcceptedFollowerIdsOfHost(hostId) {
  const rows = await Follow.find({ followingId: hostId, status: "accepted" }).select("followerId").lean();
  return rows.map((r) => r.followerId);
}

async function expirePrivateReservationIfNeeded({ event, session }) {
  const ps = event?.privateSession || null;
  if (!ps) return { expiredHandled: false };

  if (String(ps.status || "idle") !== "reserved") return { expiredHandled: false };
  if (!ps.reservedExpiresAt) return { expiredHandled: false };

  const expiresAt = new Date(ps.reservedExpiresAt);
  if (!Number.isFinite(expiresAt.getTime())) return { expiredHandled: false };

  if (Date.now() <= expiresAt.getTime()) return { expiredHandled: false };

  // --------- SCADUTA: reset + refund ----------
  const now = new Date();
  const HOLD_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 ore

    // Ticket private (se esiste): cerchiamo anche refunded per poter "unlockare" senza doppi refund
  const ticket = await Ticket.findOne({
    eventId: event._id,
    scope: "private",
    roomId: ps.roomId,
    status: { $in: ["active", "refunded"] },
  }).session(session);

  if (ticket) {
    const buyerId = ticket.userId;
    const creatorId = event.creatorId;
    const amount = Number(ticket.priceTokens || 0);

    // opId deterministico (idempotenza vera)
    const opId = `privrefund_${String(ticket._id)}`;

    // se già refunded (ticket) o già esiste ledger refund -> NON rifare contabilità
    const alreadyRefundedByTicket = String(ticket.status) === "refunded";

    const existingRefund = await TokenTransaction.findOne({
      opId,
      kind: "ticket_refund",
      direction: "credit",
      fromUserId: creatorId,
      toUserId: buyerId,
    }).session(session);

    const alreadyRefunded = alreadyRefundedByTicket || !!existingRefund;

    if (!alreadyRefunded && amount > 0) {
      // trova la tx debit originale per recuperare buckets usati (prendiamo la più recente coerente)
      const origDebit = await TokenTransaction.findOne({
        kind: "private_purchase",
        direction: "debit",
        eventId: event._id,
        scope: "private",
        roomId: ps.roomId,
        fromUserId: buyerId,
        toUserId: creatorId,
        amountTokens: amount,
      })
        .sort({ createdAt: -1 })
        .session(session);

      const buyerBuckets = (origDebit?.metadata && origDebit.metadata.buyerBuckets) || null;
      const usedFromEarnings = Number(buyerBuckets?.earnings || 0);
      const usedFromRedeemable = Number(buyerBuckets?.redeemable || 0);

      // Refund buyer: ripristino buckets + balance
      const incBuyer = { tokenBalance: amount };
      if (usedFromEarnings > 0) incBuyer.tokenEarnings = usedFromEarnings;
      if (usedFromRedeemable > 0) incBuyer.tokenRedeemable = usedFromRedeemable;

      await User.updateOne({ _id: buyerId }, { $inc: incBuyer }, { session });

      // Reverse creator credit: private funds may now be held
      const creatorBucketRaw = String(origDebit?.metadata?.creatorBucket || "").trim().toLowerCase();

      let creatorBucket = "earnings";
      if (creatorBucketRaw === "redeemable") creatorBucket = "redeemable";
      else if (creatorBucketRaw === "held") creatorBucket = "held";

      const decCreator = { tokenBalance: -amount };
      if (creatorBucket === "redeemable") decCreator.tokenRedeemable = -amount;
      else if (creatorBucket === "held") decCreator.tokenHeld = -amount;
      else decCreator.tokenEarnings = -amount;

      await User.updateOne({ _id: creatorId }, { $inc: decCreator }, { session });

      // Ledger refund (2 righe)
      const groupId = `grp_${crypto.randomUUID()}`;

      await TokenTransaction.insertMany(
        [
          {
            opId,
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
            roomId: ps.roomId,
            metadata: {
              reason: "PRIVATE_EXPIRED",
              originalOpId: origDebit?.opId || null,
              buyerBuckets: { earnings: usedFromEarnings, redeemable: usedFromRedeemable },
              creatorBucket,
            },
          },
          {
            opId,
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
            roomId: ps.roomId,
            metadata: {
              reason: "PRIVATE_EXPIRED",
              originalOpId: origDebit?.opId || null,
            },
          },
        ],
        { session, ordered: true }
      );

      // Ticket -> refunded
      ticket.status = "refunded";
      ticket.refundedAt = now;
      await ticket.save({ session });
    }
  }

  // Ritorna visibile solo quando il creator rischedula.
  event.privateSession.status = "idle";
  event.privateSession.isEnabled = false;
  event.privateSession.roomId = null;

  // hard reset reservation fields
  event.privateSession.seats = 0;

  event.privateSession.reservedByUserId = null;
  event.privateSession.reservedAt = null;
  event.privateSession.reservedExpiresAt = null;
  event.privateSession.countdownSeconds = 0;
  event.privateSession.reservedPriceTokens = null;
  event.privateSession.reservedDescription = null;

  // opzionale: pulizia timing
  event.privateSession.acceptedAt = null;
  event.privateSession.startedAt = null;

  await event.save({ session });

  return { expiredHandled: true };
}

function resetPrivateSessionToScheduled(ev) {
  if (!ev.privateSession) ev.privateSession = {};
  const ps = ev.privateSession;

  // torna prenotabile senza che il creator rischeduli
  ps.status = ps.isEnabled && ps.roomId ? "scheduled" : "idle";

  // unlock reservation
  ps.reservedByUserId = null;
  ps.reservedAt = null;
  ps.reservedExpiresAt = null;

  // pulizia dati “solo reservation”
  ps.acceptedAt = null;
  ps.reservedPriceTokens = null;
  ps.reservedDescription = "";

  // countdown solo quando reserved
  ps.countdownSeconds = 0;

  ps.lastError = null;
}

function isNativePrivateEvent(event) {
  return String(event?.accessScope || "public").trim().toLowerCase() === "private";
}

function isInternalPrivateAllowed(event) {
  return (
    String(event?.contentScope || "").trim().toUpperCase() === "HOT" &&
    !isNativePrivateEvent(event)
  );
}

function getNativeRoomScope(event) {
  return isNativePrivateEvent(event) ? "private" : "public";
}

function getNativePrivateRoomId(event) {
  return event?.privateSession?.roomId || `${event._id.toString()}_p0`;
}

function getNativePublicRoomId(event) {
  return event?.live?.roomId || event._id.toString();
}

function isCreatorEligibleForRedeemableBucket(creator) {
  return (
    (creator?.accountType === "creator" || creator?.isCreator === true) &&
    creator?.creatorEnabled === true &&
    creator?.creatorVerification?.status === "approved"
  );
}

async function releaseHeldFundsForNativePrivateEvent({ event, session, now = new Date(), reason = "EVENT_FINISHED_RELEASED" }) {
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

/**
 * @route   POST /api/events
 * @desc    Crea un nuovo evento
 *          Definisce la natura dell’evento:
 *          - contentScope
 *          - accessScope nativo
 *          - status iniziale = scheduled
 * @access  Private
 */
router.post("/", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    const accountType = getAccountTypeFromUser(user); // base | premium | creator | ecc.

    const {
      title,
      description,
      category,
      coverImage,
      startTime,
      durationMinutes,
      ticketPriceTokens,
      maxSeats,
      visibility,
      interactionMode,
      language,
      accessScope, // public/private
      contentScope, // ✅ NEW: HOT | NON_HOT (obbligatorio)
    } = req.body;

    const safeTitle = String(title || "").trim();
    const safeDescription = String(description || "").trim();

    const titleCheck = detectContentSafety(safeTitle, "public");
    if (titleCheck.blocked) {
      return res.status(400).json({
        status: "error",
        code: titleCheck.code,
        message: "Links, contacts, and external invitations are not allowed in event title.",
      });
    }

    const descriptionCheck = detectContentSafety(safeDescription, "public");
    if (descriptionCheck.blocked) {
      return res.status(400).json({
        status: "error",
        code: descriptionCheck.code,
        message: "Links, contacts, and external invitations are not allowed in event description.",
      });
    }

    // 🔹 Validazioni base campi obbligatori
    if (
      !title ||
      !description ||
      !category ||
      !startTime ||
      durationMinutes === undefined ||
      ticketPriceTokens === undefined ||
      !interactionMode
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "Missing mandatory fields. Required: title, description, category, startTime, durationMinutes, ticketPriceTokens, interactionMode",
      });
    }

    // 🔹 Normalizziamo numeri
    const safeDuration = Number(durationMinutes);
    if (!Number.isFinite(safeDuration) || safeDuration < 0) {
      return res.status(400).json({
        status: "error",
        message: "durationMinutes cannot be negative",
      });
    }

    const price = Number(ticketPriceTokens);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({
        status: "error",
        message: "ticketPriceTokens cannot be negative",
      });
    }

    const isPaidEvent = price > 0;

    // ✅ accessScope (default public)
    const accessScopeRaw = (accessScope ?? "public").toString().trim().toLowerCase();
    const safeAccessScope = accessScopeRaw === "private" ? "private" : "public";

    // ✅ contentScope obbligatorio: HOT | NON_HOT
    const contentScopeRaw = (contentScope ?? "").toString().trim().toUpperCase();
    if (!["HOT", "NO_HOT"].includes(contentScopeRaw)) {
      return res.status(400).json({
        status: "error",
        message: "Mandatory contentScope: 'HOT' or 'NO_HOT'",
      });
    }

    // ✅ business rules:
    // NO_HOT può nascere SOLO private + paid
    if (contentScopeRaw === "NO_HOT" && safeAccessScope !== "private") {
      return res.status(400).json({
        status: "error",
        message: "NO_HOT events can only be created as private events",
      });
    }

    if (contentScopeRaw === "NO_HOT" && price <= 0) {
      return res.status(400).json({
        status: "error",
        message: "NO_HOT events must be ticketed (ticketPriceTokens must be greater than 0)",
      });
    }

    // ✅ maxSeats: obbligatorio SOLO se paid, altrimenti illimitato (null)
    let safeMaxSeats = null; // null = illimitato per free
    if (isPaidEvent) {
      const seatsNum = Number(maxSeats);
      if (!Number.isFinite(seatsNum) || seatsNum <= 0) {
        return res.status(400).json({
          status: "error",
          message: "maxSeats is required when the ticket has a price > 0",
        });
      }
      safeMaxSeats = Math.floor(seatsNum);
    }

    // 🔹 interactionMode
    if (!["broadcast", "interactive"].includes(interactionMode)) {
      return res.status(400).json({
        status: "error",
        message: "interactionMode must be 'broadcast' or 'interactive'",
      });
    }

    // 🔹 visibility (fallback su 'public')
    const allowedVisibility = ["public", "followers", "unlisted"];
    const safeVisibility = allowedVisibility.includes(visibility) ? visibility : "public";
    const creator = await User.findById(user._id).select("area language profileType").lean();

    const safeArea = (creator?.area ? String(creator.area) : "").trim().toLowerCase();
    const safeLang = (creator?.language ? String(creator.language) : "").trim().toLowerCase();
    const safeProfileType = (creator?.profileType ? String(creator.profileType) : "").trim().toLowerCase();

    const event = new Event({
      creatorId: user._id,
      title: safeTitle,
      description: safeDescription,
      category,
      language: (language ? String(language) : (safeLang || "it")).trim().toLowerCase(),
      area: safeArea,
      targetProfileType: safeProfileType,
      contentScope: contentScopeRaw,
      coverImage,
      startTime,
      durationMinutes: safeDuration,
      ticketPriceTokens: price, // 0 = gratis
      maxSeats: safeMaxSeats,
      accessScope: safeAccessScope, // ✅ NEW
      visibility: safeVisibility,
      interactionMode,
      status: "scheduled",

      // pianificazione
      plannedStartTime: startTime,
      plannedDurationMinutes: safeDuration,
      plannedInteractionMode: interactionMode,

      // NestX live model: viewers can chat also in broadcast mode.
      // broadcast only blocks viewer A/V, not text chat.
      chatEnabledForViewers: true,
    });

    const saved = await event.save();

    // Evento nato private:
    // manteniamo un roomId nativo coerente senza farlo entrare nel lifecycle della private interna HOT/public
    if (saved.accessScope === "private") {
      const baseRoomId = `${saved._id.toString()}_p0`;

      await Event.updateOne(
        { _id: saved._id, "privateSession.roomId": { $in: [null, undefined] } },
        {
          $set: {
            privateSessionCounter: 0,
            privateSession: {
              roomId: baseRoomId,
              isEnabled: true,
              status: "idle",
              seats: Number.isFinite(saved.maxSeats) && saved.maxSeats > 0 ? saved.maxSeats : 0,
              ticketPriceTokens: Number.isFinite(saved.ticketPriceTokens) ? saved.ticketPriceTokens : 0,
              countdownSeconds: 0,
              scheduledAt: saved.startTime || new Date(),
              startedAt: null,
              acceptedAt: null,
              reservedByUserId: null,
              reservedAt: null,
              reservedExpiresAt: null,
              reservedPriceTokens: null,
              reservedDescription: null,
            },
          },
        }
      );

      await LiveRoom.updateOne(
        { eventId: saved._id, scope: "private" },
        {
          $set: {
            roomId: baseRoomId,
            hostId: saved.creatorId,
            status: "scheduled",
          },
        },
        { upsert: true }
      );
    }

    return res.status(201).json({
      status: "success",
      data: {
        id: saved._id,
        title: saved.title,
        description: saved.description,
        category: saved.category,
        startTime: saved.startTime,
        durationMinutes: saved.durationMinutes,
        ticketPriceTokens: saved.ticketPriceTokens,
        maxSeats: saved.maxSeats,
        accessScope: saved.accessScope,
        contentScope: saved.contentScope,
        visibility: saved.visibility,
        interactionMode: saved.interactionMode,
        chatEnabledForViewers: saved.chatEnabledForViewers,
        status: saved.status,
        createdAt: saved.createdAt,
      },
    });
  } catch (err) {
    console.error("Event creation error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while creating the event",
    });
  }
});

/**
 * @route   POST /api/events/:id/go-live
 * @desc    Il creator avvia l'evento in modalità live
 * @access  Private (solo creator)
 */
router.post("/:id/go-live", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    const eventId = req.params.id;

    if (!eventId || eventId.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Invalid event ID",
      });
    }

    const event = await Event.findById(eventId).exec();

    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    // solo il creator può avviare la live
    if (event.creatorId.toString() !== user._id.toString()) {
      return res.status(403).json({
        status: "error",
        message: "Only the event host can start the live broadcast",
      });
    }

    // se è già finito o cancellato, non lo riapriamo
    if (event.status === "finished" || event.status === "cancelled") {
      return res.status(400).json({
        status: "error",
        message: "You can't go live on a closed or cancelled event",
      });
    }

    // ✅ SAFETY: contentScope obbligatorio (HOT/NON_HOT)
    // Se manca (event vecchi), blocchiamo il go-live: evita che roba NON-HOT finisca in HOT o viceversa.
    const cs = (event.contentScope ?? "").toString().trim().toUpperCase();
    if (cs !== "HOT" && cs !== "NO_HOT") {
      return res.status(400).json({
        status: "error",
        code: "CONTENT_SCOPE_MISSING",
        message: "contentScope missing: set 'HOT' or 'NO_HOT' before going live",
      });
    }

    const now = new Date();
    const nativeRoomScope = getNativeRoomScope(event);

    if (!event.live) {
      event.live = {};
    }

    event.status = "live";

    if (!event.live.startedAt) {
      event.live.startedAt = now;
    }

    // Evento nato public -> room pubblica nativa
    if (nativeRoomScope === "public") {
      if (!event.live.roomId) {
        event.live.roomId = event._id.toString();
      }
    }

    // Evento nato private -> room privata nativa
    // NON va reinterpretato come private interna
    if (nativeRoomScope === "private") {
      if (!event.privateSession) event.privateSession = {};

      const nativePrivateRoomId = event.privateSession.roomId || `${event._id.toString()}_p0`;

      event.privateSession = {
        ...event.privateSession,
        roomId: nativePrivateRoomId,
        isEnabled: true,
        status: event.privateSession?.status || "idle",
        seats: (typeof event.maxSeats === "number" && event.maxSeats > 0) ? event.maxSeats : 0,
        ticketPriceTokens: Number(event.ticketPriceTokens || 0),
        countdownSeconds: 0,
        scheduledAt: event.privateSession?.scheduledAt || event.startTime || now,
        reservedByUserId: null,
        reservedAt: null,
        reservedExpiresAt: null,
        reservedPriceTokens: null,
        reservedDescription: null,
      };

      // importante: per native private NON esiste una public room nativa
      event.live.roomId = null;
    }

    await event.save();

    // =========================
    // NOTIF: EVENT_WENT_LIVE
    // - ticket holders (public) sempre
    // - follower host SOLO se profilePromoEnabled=true e visibility != unlisted
    // =========================
    (async () => {
      try {
        const eventIdStr = event._id.toString();
        const hostIdStr = event.creatorId.toString();

        // 1) ticket holders (scope corretto)
        // - se evento nasce private => ticket sono scope=private + roomId=_p0
        // - altrimenti => scope=public
        let ticketUserIds = [];
        let notifScope = "public";
        let notifRoomId = null;

        if ((event.accessScope || "").toString().trim().toLowerCase() === "private") {
          const roomId = event.privateSession?.roomId || `${event._id.toString()}_p0`;
          ticketUserIds = await getPrivateTicketUserIds(event._id, roomId);
          notifScope = "private";
          notifRoomId = roomId;
        } else {
          ticketUserIds = await getPublicTicketUserIds(event._id);
        }

        await createNotifForUsers({
          userIds: ticketUserIds,
          actorId: event.creatorId,
          type: "EVENT_WENT_LIVE",
          targetType: "event",
          targetId: event._id,
          message: "An event for which you have a ticket went live",
          data: { eventId: event._id, scope: notifScope, roomId: notifRoomId },
          dedupeBase: `event_live:${eventIdStr}:${notifScope}${notifRoomId ? ":" + notifRoomId : ""}`,
        });

        // 2) follower SOLO se profilePromoEnabled=true e non unlisted
        const promoEnabled = event.profilePromoEnabled === true;
        const notUnlisted = (event.visibility || "public") !== "unlisted";

        if (promoEnabled && notUnlisted) {
          const followerIds = await getAcceptedFollowerIdsOfHost(event.creatorId);

          await createNotifForUsers({
            userIds: followerIds,
            actorId: event.creatorId,
            type: "EVENT_WENT_LIVE",
            targetType: "event",
            targetId: event._id,
            message: "An event of a creator you follow went live",
            data: { eventId: event._id, scope: "public", via: "profilePromo" },
            dedupeBase: `event_live:${eventIdStr}:followers`,
          });
        }
      } catch (e) {
        console.error("EVENT_WENT_LIVE_NOTIFY_FAILED", e?.message || e);
      }
    })();

    if (nativeRoomScope === "public") {
      await LiveRoom.updateOne(
        { eventId: event._id, scope: "public" },
        {
          $set: {
            roomId: getNativePublicRoomId(event),
            hostId: event.creatorId,
            status: "active",
          },
        },
        { upsert: true }
      );
    } else {
      await LiveRoom.updateOne(
        { eventId: event._id, scope: "private" },
        {
          $set: {
            roomId: getNativePrivateRoomId(event),
            hostId: event.creatorId,
            status: "active",
          },
        },
        { upsert: true }
      );
    }

    return res.status(200).json({
      status: "success",
      message: "Event started in live mode",
      data: {
        id: event._id,
        status: event.status,
        live: event.live || null,
      },
    });
  } catch (err) {
    console.error("Event go-live error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while going live with the event",
    });
  }
});

/**
 * @route   POST /api/events/:id/private/schedule
 * @desc    L'host programma il passaggio a sessione privata (Strategia 3)
 * @access  Private (host/creator)
 */
router.post("/:id/private/schedule", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const { seats, description } = req.body;
    // --- NORMALIZZAZIONE PRICE (alias body) ---
    const rawPrice =
      req.body.ticketPriceTokens ?? req.body.priceTokens ?? req.body.priceTokenTokens;

    const priceTokensNum = Number(rawPrice);
    const safePriceTokens = Number.isFinite(priceTokensNum) && priceTokensNum >= 0 ? priceTokensNum : 0;

    if (!Number.isFinite(safePriceTokens) || safePriceTokens <= 0) {
      return res.status(400).json({
        status: "error",
        code: "PRIVATE_SESSION_NOT_PAID",
        message: "Private session cannot be free",
      });
    }

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    // controlliamo che sia davvero l'host
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    if (
      event.contentScope !== "HOT" ||
      event.accessScope !== "public"
    ) {
      return res.status(400).json({
        status: "error",
        code: "PRIVATE_SESSION_NOT_ALLOWED",
        message: "Internal private sessions allowed only for HOT public events"
      });
    }

    if (event.creatorId.toString() !== user._id.toString()) {
      return res.status(403).json({
        status: "error",
        message: "Only the host can schedule the private session",
      });
    }

    if (event.status !== "live") {
      return res.status(400).json({
        status: "error",
        message: "You can schedule the private session only during the live",
      });
    }

    // interlock: Private disabled while Goal active
    if (event.live?.goal?.isActive === true) {
      return res.status(400).json({
        status: "error",
        code: "PRIVATE_BLOCKED_BY_GOAL",
        message: "Private session disabled because a goal is active.",
      });
    }

    // se già è in privata o schedulata, blocchiamo
    if (
      event.privateSession &&
      ["scheduled", "reserved", "running"].includes(event.privateSession.status)
    ) {
      return res.status(400).json({
        status: "error",
        message: "There is already a private session scheduled or in progress",
      });
    }

    // normalizzazione input
    const safeSeats = 1;
  
    // safety per eventi vecchi
    // ✅ BLOCCO SOLO SE C'È DAVVERO UNA PRIVATA ATTIVA/PROGRAMMATA
    const ps = event.privateSession;

    if (
      ps &&
      ps.isEnabled === true &&
      ["scheduled", "running"].includes(ps.status)
    ) {
      return res.status(400).json({
        status: "error",
        message: "There is already a private session scheduled or in progress",
        data: { privateSession: ps },
      });
    }

    // inizializzazione CONTATORE SOLO SE NON ESISTE
    if (event.privateSessionCounter == null) {
      event.privateSessionCounter = 0;
    }

    // incrementiamo UNA SOLA VOLTA
    event.privateSessionCounter += 1;

    const privateRoomId = `${event._id.toString()}_p${event.privateSessionCounter}`;
    const rawDesc = typeof description === "string" ? description.trim() : "";
    const safeDesc = rawDesc.slice(0, 140);

    // ✅ CREAZIONE UNICA della privateSession
    event.privateSession = {
      roomId: privateRoomId,
      isEnabled: true,
      status: "scheduled",
      seats: safeSeats,
      ticketPriceTokens: safePriceTokens,
      description: safeDesc, // ✅ NEW
      scheduledAt: new Date(),
      startedAt: null,
    };
    await event.save();

    return res.status(200).json({
      status: "success",
      message: "Private session scheduled",
      data: {
        eventId: event._id,
        privateSession: event.privateSession,
      },
    });
  } catch (err) {
    console.error("Error during private session scheduling:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while scheduling the private session",
    });
  }
});

/**
 * @route   POST /api/events/:id/private/cancel
 * @desc    Host cancels a scheduled private session before reservation
 * @access  Private (host/creator)
 */
router.post("/:id/private/cancel", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    if (
      event.contentScope !== "HOT" ||
      event.accessScope !== "public"
    ) {
      return res.status(400).json({
        status: "error",
        code: "PRIVATE_SESSION_NOT_ALLOWED",
        message: "Internal private sessions allowed only for HOT public events",
      });
    }

    if (String(event.creatorId) !== String(user._id)) {
      return res.status(403).json({
        status: "error",
        message: "Only the host can cancel the private session",
      });
    }

    if (event.status !== "live") {
      return res.status(400).json({
        status: "error",
        code: "EVENT_NOT_LIVE",
        message: "Event is not live",
      });
    }

    const ps = event.privateSession || null;

    if (!ps || ps.status !== "scheduled") {
      return res.status(400).json({
        status: "error",
        code: "PRIVATE_NOT_SCHEDULED",
        message: "No scheduled private session to cancel",
        data: { privateSession: ps },
      });
    }

    event.privateSession.status = "cancelled";
    event.privateSession.isEnabled = false;
    event.privateSession.cancelledAt = new Date();

    await event.save();

    return res.status(200).json({
      status: "success",
      message: "Private session cancelled",
      data: {
        eventId: event._id,
        privateSession: event.privateSession,
      },
    });
  } catch (err) {
    console.error("Error during private session cancel:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while cancelling the private session",
    });
  }
});

/**
 * @route   POST /api/events/:id/private/buy
 * @desc    Buyer buys private slot (reserve) during public live
 * @access  Private
 */
router.post("/:id/private/buy", auth, featureGuard("live"), async (req, res) => {
  const session = await mongoose.startSession()

  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ status: "error", message: "Unauthenticated user" });
    }

    const eventId = req.params.id;

    const t0 = Date.now();
    const mark = (label) => {
      console.log(`[PRIVATE][TIMING] ${label}`, {
        at: new Date().toISOString(),
        ms: Date.now() - t0,
        eventId: String(eventId || ""),
        buyerId: String(user?._id || ""),
      });
    };

    const WAIT_SECONDS = 120;

    logPrivateFlow("START", {
      route: "POST /api/events/:id/private/buy",
      eventId: String(eventId || ""),
      buyerId: String(user?._id || ""),
    });

    const opIdRaw = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    const opId =
      typeof opIdRaw === "string" && opIdRaw.trim().length >= 8
        ? opIdRaw.trim()
        : `priv_${eventId}_${user._id.toString()}_${crypto.randomUUID()}`;

    const groupId = `grp_${crypto.randomUUID()}`;

    let payloadOut = null;

    await session.withTransaction(async () => {
      const event = await Event.findById(eventId)
        .select("_id creatorId status contentScope accessScope live privateSession")
        .lean()
        .session(session);

      if (!event) {
        const e = new Error("Event not found");
        e.httpStatus = 404;
        e.payload = { status: "error", message: "Event not found" };
        throw e;
      }

      if (event.contentScope !== "HOT" || event.accessScope !== "public") {
        const e = new Error("PRIVATE_SESSION_NOT_ALLOWED");
        e.httpStatus = 400;
        e.payload = {
          status: "error",
          code: "PRIVATE_SESSION_NOT_ALLOWED",
          message: "Internal private sessions allowed only for HOT public events",
        };
        throw e;
      }

      if (String(event.creatorId) === String(user._id)) {
        const e = new Error("HOST_CANNOT_BUY_PRIVATE");
        e.httpStatus = 403;
        e.payload = { status: "error", message: "Host cannot buy private" };
        throw e;
      }

      if (event.status !== "live") {
        const e = new Error("EVENT_NOT_LIVE");
        e.httpStatus = 400;
        e.payload = {
          status: "error",
          code: "EVENT_NOT_LIVE",
          message: "Event is not live",
        };
        throw e;
      }

      if (event.live?.goal?.isActive === true) {
        const e = new Error("PRIVATE_BLOCKED_BY_GOAL");
        e.httpStatus = 400;
        e.payload = {
          status: "error",
          code: "PRIVATE_BLOCKED_BY_GOAL",
          message: "Private session disabled because a goal is active.",
        };
        throw e;
      }

      const ps = event.privateSession || null;

      if (!ps?.isEnabled || !ps?.roomId) {
        const e = new Error("PRIVATE_NOT_ENABLED");
        e.httpStatus = 400;
        e.payload = {
          status: "error",
          code: "PRIVATE_NOT_ENABLED",
          message: "Private session not available",
        };
        throw e;
      }

      const priceTokens = Number(ps.ticketPriceTokens || 0);
      if (!Number.isFinite(priceTokens) || priceTokens <= 0) {
        const e = new Error("PRIVATE_SESSION_NOT_PAID");
        e.httpStatus = 400;
        e.payload = {
          status: "error",
          code: "PRIVATE_SESSION_NOT_PAID",
          message: "Private session cannot be free",
        };
        throw e;
      }

      if (!tokensRuntimeEnabled()) {
        const e = new Error("TOKENS_DISABLED");
        e.httpStatus = 403;
        e.payload = {
          status: "error",
          code: "TOKENS_DISABLED",
          message: "Private purchase is currently disabled",
        };
        throw e;
      }

      const isBlocked = await isUserBlockedEitherSide(String(user._id), String(event.creatorId));
      if (isBlocked) {
        const e = new Error("EVENT_BLOCKED");
        e.httpStatus = 403;
        e.payload = {
          status: "error",
          code: "EVENT_BLOCKED",
          message: "Event not available",
        };
        throw e;
      }

      const existingDebitTx = await TokenTransaction.findOne({
        opId,
        kind: "private_purchase",
        direction: "debit",
        eventId: event._id,
        scope: "private",
        roomId: ps.roomId,
        fromUserId: user._id,
        toUserId: event.creatorId,
      })
        .lean()
        .session(session);

      if (existingDebitTx) {
        const existingTicket = await Ticket.findOne({
          eventId: event._id,
          userId: user._id,
          scope: "private",
          roomId: ps.roomId,
          status: "active",
        })
          .lean()
          .session(session);

        const now = new Date();
        const expiresAt = new Date(now.getTime() + WAIT_SECONDS * 1000);

        payloadOut = {
          status: "success",
          message: "Private reserved. Waiting for host confirmation.",
          data: {
            eventId: event._id,
            roomId: ps.roomId,
            priceTokens,
            waitSeconds: WAIT_SECONDS,
            expiresAt,
            ticketId: existingTicket?._id || null,
            replayed: true,
          },
        };

        return;
      }

      const existingTicket = await Ticket.findOne({
        eventId: event._id,
        userId: user._id,
        scope: "private",
        roomId: ps.roomId,
        status: "active",
      })
        .lean()
        .session(session);

      if (existingTicket) {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + WAIT_SECONDS * 1000);

        const reserveUpdate = await Event.updateOne(
          {
            _id: event._id,
            "privateSession.roomId": ps.roomId,
            "privateSession.status": { $nin: ["reserved", "running"] },
          },
          {
            $set: {
              "privateSession.status": "reserved",
              "privateSession.seats": 1,
              "privateSession.reservedByUserId": user._id,
              "privateSession.reservedAt": now,
              "privateSession.reservedExpiresAt": expiresAt,
              "privateSession.countdownSeconds": WAIT_SECONDS,
              "privateSession.reservedPriceTokens": priceTokens,
              "privateSession.reservedDescription": String(ps.description || ""),
            },
          },
          { session }
        );

        if (reserveUpdate.modifiedCount !== 1) {
          const e = new Error("PRIVATE_ALREADY_RESERVED");
          e.httpStatus = 409;
          e.payload = {
            status: "error",
            code: "PRIVATE_ALREADY_RESERVED",
            message: "Private session already reserved",
          };
          throw e;
        }

        payloadOut = {
          status: "success",
          message: "Private reserved. Waiting for host confirmation.",
          data: {
            eventId: event._id,
            roomId: ps.roomId,
            priceTokens: existingTicket.priceTokens || priceTokens,
            waitSeconds: WAIT_SECONDS,
            expiresAt,
            ticketId: existingTicket._id,
          },
        };

        return;
      }

      if (["reserved", "running"].includes(String(ps.status || "idle"))) {
        const e = new Error("PRIVATE_ALREADY_RESERVED");
        e.httpStatus = 409;
        e.payload = {
          status: "error",
          code: "PRIVATE_ALREADY_RESERVED",
          message: "Private session already reserved",
        };
        throw e;
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + WAIT_SECONDS * 1000);

      const reserveUpdate = await Event.updateOne(
        {
          _id: event._id,
          "privateSession.roomId": ps.roomId,
          "privateSession.status": { $nin: ["reserved", "running"] },
        },
        {
          $set: {
            "privateSession.status": "reserved",
            "privateSession.seats": 1,
            "privateSession.reservedByUserId": user._id,
            "privateSession.reservedAt": now,
            "privateSession.reservedExpiresAt": expiresAt,
            "privateSession.countdownSeconds": WAIT_SECONDS,
            "privateSession.reservedPriceTokens": priceTokens,
            "privateSession.reservedDescription": String(ps.description || ""),
          },
        },
        { session }
      );

      if (reserveUpdate.modifiedCount !== 1) {
        const e = new Error("PRIVATE_ALREADY_RESERVED");
        e.httpStatus = 409;
        e.payload = {
          status: "error",
          code: "PRIVATE_ALREADY_RESERVED",
          message: "Private session already reserved",
        };
        throw e;
      }

      const payment = await chargeUserToCreator({
        buyerId: user._id,
        creatorId: event.creatorId,
        amountTokens: priceTokens,
        kind: "private_purchase",
        context: "ticket",
        contextId: String(event._id),
        eventId: event._id,
        scope: "private",
        roomId: ps.roomId,
        creatorBucket: "held",
        metadata: {
          privateFundsStatus: "held",
        },
        session,
        opId,
        groupId,
      });

      if (!payment.ok) {
        const e = new Error(payment.code || "PRIVATE_PAYMENT_FAILED");
        e.httpStatus = payment.code === "INSUFFICIENT_TOKENS" ? 400 : 409;
        e.payload = {
          status: "error",
          code: payment.code || "PRIVATE_PAYMENT_FAILED",
          message:
            payment.code === "INSUFFICIENT_TOKENS"
              ? "Insufficient tokens"
              : "Private payment could not be completed",
        };
        throw e;
      }

      const createdTickets = await Ticket.create(
        [
          {
            eventId: event._id,
            userId: user._id,
            scope: "private",
            roomId: ps.roomId,
            priceTokens,
            purchasedAt: new Date(),
            status: "active",
          },
        ],
        { session }
      );

      const ticket = createdTickets?.[0] || null;

      logPrivateFlow("SUCCESS", {
        route: "POST /api/events/:id/private/buy",
        eventId: String(event._id || ""),
        buyerId: String(user?._id || ""),
        creatorId: String(event.creatorId || ""),
        roomId: String(ps?.roomId || ""),
        priceTokens: Number(priceTokens || 0),
        mode: "new_purchase",
        ticketId: ticket?._id ? String(ticket._id) : null,
        opId,
        groupId,
        creatorBucket: "held",
      });

      payloadOut = {
        status: "success",
        message: "Private reserved. Waiting for host confirmation.",
        data: {
          eventId: event._id,
          roomId: ps.roomId,
          priceTokens,
          waitSeconds: WAIT_SECONDS,
          expiresAt,
          ticketId: ticket?._id || null,
        },
      };
    });

    return res.status(200).json(payloadOut);
  } catch (e) {
    logPrivateFlow("ERROR", {
      route: "POST /api/events/:id/private/buy",
      eventId: String(req.params?.id || ""),
      buyerId: String(req.user?._id || ""),
      message: e?.message || "unknown_error",
      statusCode: e?.httpStatus || 500,
      code: e?.payload?.code || null,
      stack: e?.stack || null,
    });

    if (e && e.httpStatus && e.payload) {
      return res.status(e.httpStatus).json(e.payload);
    }

    console.error("PRIVATE_BUY_FAILED", e?.message || e);
    return res.status(500).json({
      status: "error",
      message: "Internal error while buying private session",
    });
  } finally {
    session.endSession();
  }
});

/**
 * @route   POST /api/events/:id/private/accept
 * @desc    Host accepts reserved private session -> running
 * @access  Private (host)
 */
router.post("/:id/private/accept", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const eventId = req.params.id;
    const event = await Event.findById(eventId).exec();
    if (!event) return res.status(404).json({ status: "error", message: "Event not found" });

    if (
      event.contentScope !== "HOT" ||
      event.accessScope !== "public"
    ) {
      return res.status(400).json({
        status: "error",
        code: "PRIVATE_SESSION_NOT_ALLOWED",
        message: "Internal private sessions allowed only for HOT public events"
      });
    }

    if (String(event.creatorId) !== String(user._id)) {
      return res.status(403).json({ status: "error", message: "Only host can accept private session" });
    }

    if (event.status !== "live") {
      return res.status(400).json({ status: "error", code: "EVENT_NOT_LIVE", message: "Event is not live" });
    }

    const ps = event.privateSession || null;
    if (!ps?.roomId) {
      return res.status(400).json({
        status: "error",
        code: "PRIVATE_NOT_ENABLED",
        message: "Private session not available",
      });
    }

    if (String(ps.status || "idle") !== "reserved") {
      return res.status(400).json({ status: "error", code: "PRIVATE_NOT_RESERVED", message: "Private session is not reserved" });
    }

    const session = await mongoose.startSession();
    try {
      let expiredHandled = false;

      await session.withTransaction(async () => {
        const evTx = await Event.findById(eventId).session(session).exec();
        if (!evTx) return;

        const out = await expirePrivateReservationIfNeeded({ event: evTx, session });
        expiredHandled = !!out.expiredHandled;

        const psTx = evTx.privateSession || null;

        if (!expiredHandled) {
          if (String(psTx?.status || "idle") !== "reserved") {
            const e = new Error("PRIVATE_NOT_RESERVED");
            e._code = "PRIVATE_NOT_RESERVED";
            throw e;
          }

          evTx.privateSession.status = "running";
          evTx.privateSession.startedAt = new Date();
          evTx.privateSession.acceptedAt = new Date();

          await evTx.save({ session });

          await LiveRoom.updateOne(
            { eventId: evTx._id, scope: "private" },
            {
              $set: {
                roomId: psTx.roomId,
                hostId: evTx.creatorId,
                status: "active",
              },
            },
            { upsert: true, session }
          );

          Object.assign(event, evTx.toObject());
        } else {
          Object.assign(event, evTx.toObject());
        }
      });

      if (expiredHandled) {
        return res.status(409).json({
          status: "error",
          code: "PRIVATE_EXPIRED",
          message: "Reservation expired",
        });
      }

      return res.status(200).json({
        status: "success",
        message: "Private session accepted",
        data: { eventId: event._id, privateSession: event.privateSession },
      });
    } catch (e) {
      if (e && e._code === "PRIVATE_NOT_RESERVED") {
        return res.status(400).json({ status: "error", code: "PRIVATE_NOT_RESERVED", message: "Private session is not reserved" });
      }
      console.error("PRIVATE_ACCEPT_FAILED", e?.message || e);
      return res.status(500).json({ status: "error", message: "Internal error while accepting private session" });
    } finally {
      session.endSession();
    }
  } catch (e) {
    console.error("PRIVATE_ACCEPT_FAILED", e?.message || e);
    return res.status(500).json({ status: "error", message: "Internal error while accepting private session" });
  }
});

/**
 * @route   POST /api/events/:id/private/finish
 * @desc    Termina la sessione privata e torna alla sessione pubblica
 * @access  Private (solo creator)
 */
router.post("/:id/private/finish", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const eventId = req.params.id;
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid event ID" });
    }

    const event = await Event.findById(eventId).exec();
    if (!event) return res.status(404).json({ status: "error", message: "Event not found" });

    if (
      event.contentScope !== "HOT" ||
      event.accessScope !== "public"
    ) {
      return res.status(400).json({
        status: "error",
        code: "PRIVATE_SESSION_NOT_ALLOWED",
        message: "Internal private sessions allowed only for HOT public events"
      });
    }

    if (event.creatorId.toString() !== user._id.toString()) {
      return res.status(403).json({ status: "error", message: "Only the host can finish the private session" });
    }

    if (event.status === "finished") {
      return res.status(403).json({
        status: "error",
        code: "EVENT_FINISHED",
      });
    }

    if (event.status !== "live") {
      return res.status(403).json({
        status: "error",
        code: "EVENT_NOT_LIVE",
      });
    }

    const ps = event.privateSession || null;
    if (!ps || ps.status !== "running") {
      return res.status(400).json({
        status: "error",
        message: "No private session running",
        data: { privateSession: ps },
      });
    }

    // ✅ chiudo privata + torno public
    event.privateSession.status = "completed";

    await event.save();

    return res.status(200).json({
      status: "success",
      message: "Private session finished",
      data: { eventId: event._id, accessScope: event.accessScope, privateSession: event.privateSession },
    });
  } catch (err) {
    console.error("Error private/finish:", err);
    return res.status(500).json({ status: "error", message: "Internal error while finishing private session" });
  }
});

// =========================
// GOAL (live tips progress)
// =========================

// CREATE GOAL
router.post("/:id/goal/create", auth, featureGuard("live"), featureGuard("tokens"), async (req, res) => {
  try {
    const eventId = req.params.id;
    const { targetTokens, title, description } = req.body;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ status: "error", message: "Invalid event id" });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ status: "error", message: "Event not found" });
    }

    if (!event.creatorId.equals(req.user._id)) {
      return res.status(403).json({
        status: "error",
        message: "Only host can manage goal",
      });
    }

    if (String(event.status) !== "live") {
      return res.status(400).json({ status: "error", message: "Goal allowed only during live" });
    }

    // Interlock: no goal if private active
    const ps = event.privateSession || {};
    if (["scheduled", "reserved", "running"].includes(String(ps.status))) {
      return res.status(400).json({
        status: "error",
        code: "GOAL_BLOCKED_BY_PRIVATE",
        message: "Cannot create goal while private session is active.",
      });
    }

    const target = Number(targetTokens);
    if (!Number.isFinite(target) || target <= 0) {
      return res.status(400).json({ status: "error", message: "Invalid targetTokens" });
    }

    const now = new Date();

    event.goal = {
      isActive: true,
      targetTokens: target,
      progressTokens: 0,
      title: String(title || "").trim().slice(0, 80),
      description: String(description || "").trim().slice(0, 140),
      reachedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await event.save();

    return res.status(200).json({
      status: "success",
      data: {
        goal: {
          isActive: true,
          targetTokens: target,
          progressTokens: 0,
          title: String(event.goal?.title || ""),
          description: String(event.goal?.description || ""),
          reachedAt: null,
        },
        tipTotalTokens: Number(event.tipTotalTokens || 0),
      },
    });
  } catch (err) {
    console.error("GOAL_CREATE_ERROR", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// RESET GOAL
router.post("/:id/goal/reset", auth, featureGuard("live"), featureGuard("tokens"), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ status: "error", message: "Event not found" });

    if (!event.creatorId.equals(req.user._id)) {
      return res.status(403).json({
        status: "error",
        message: "Only host can reset goal",
      });
    }

    if (!event.goal?.isActive) {
      return res.status(400).json({ status: "error", code: "GOAL_NOT_ACTIVE", message: "Goal not active" });
    }

    event.goal.progressTokens = 0;
    event.goal.reachedAt = null;
    event.goal.updatedAt = new Date();

    await event.save();

    return res.status(200).json({
      status: "success",
      data: {
        goal: {
          isActive: true,
          targetTokens: Number(event.goal?.targetTokens || 0),
          progressTokens: 0,
          title: String(event.goal?.title || ""),
          description: String(event.goal?.description || ""),
          reachedAt: null,
        },
        tipTotalTokens: Number(event.tipTotalTokens || 0),
      },
    });
  } catch (err) {
    console.error("GOAL_RESET_ERROR", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// STOP GOAL
router.post("/:id/goal/stop", auth, featureGuard("live"), featureGuard("tokens"), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ status: "error", message: "Event not found" });

    if (!event.creatorId.equals(req.user._id)) {
      return res.status(403).json({
        status: "error",
        message: "Only host can stop goal",
      });
    }

    if (event.goal) {
      event.goal.isActive = false;
      event.goal.updatedAt = new Date();
      await event.save();
    }

    return res.status(200).json({
      status: "success",
      data: {
        goal: {
          isActive: false,
          targetTokens: Number(event.goal?.targetTokens || 0),
          progressTokens: Number(event.goal?.progressTokens || 0),
          title: String(event.goal?.title || ""),
          description: String(event.goal?.description || ""),
          reachedAt: event.goal?.reachedAt || null,
        },
        tipTotalTokens: Number(event.tipTotalTokens || 0),
      },
    });
  } catch (err) {
    console.error("GOAL_STOP_ERROR", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * @route   POST /api/events/:id/finish
 * @desc    Il creator termina la live e chiude l'evento
 * @access  Private (solo creator)
 */
router.post("/:id/finish", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    const eventId = req.params.id;

    if (!eventId || eventId.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Invalid event ID",
      });
    }

    const event = await Event.findById(eventId).exec();

    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    // solo il creator può chiudere l'evento
    if (event.creatorId.toString() !== user._id.toString()) {
      return res.status(403).json({
        status: "error",
        message: "Only the host of the event can close the live",
      });
    }

    // se è già finito, non facciamo casino
    if (event.status === "finished" || event.status === "cancelled") {
      return res.status(200).json({
        status: "ok",
        message: "Event already closed",
        data: {
          id: event._id,
          status: event.status,
        },
      });
    }

    const now = new Date();
    const HOLD_WINDOW_MS = 24 * 60 * 60 * 1000;

    const finishSession = await mongoose.startSession();
    let refundedPrivateBuyerIds = [];

    try {
      await finishSession.withTransaction(async () => {
        const eventTx = await Event.findById(eventId).session(finishSession).exec();
        if (!eventTx) {
          const e = new Error("Event not found");
          e.httpStatus = 404;
          e.payload = { status: "error", message: "Event not found" };
          throw e;
        }

        // idempotenza dentro TX
        if (eventTx.status === "finished" || eventTx.status === "cancelled") {
          return;
        }

        const isInternalPrivate = isInternalPrivateAllowed(eventTx);
        const ps = eventTx.privateSession || null;

        const isNativePrivate = isNativePrivateEvent(eventTx);
        const isPaidNativePrivate = isNativePrivate && Number(eventTx.ticketPriceTokens || 0) > 0;

        // Se è una private interna HOT/public in stato reserved,
        // prima rimborsiamo in modo atomico, poi chiudiamo l'evento.
        if (isInternalPrivate && ps && String(ps.status || "idle") === "reserved") {
          const reservedTicket = await Ticket.findOne({
            eventId: eventTx._id,
            scope: "private",
            roomId: ps.roomId,
            status: { $in: ["active", "refunded"] },
          }).session(finishSession);

          if (reservedTicket) {
            const buyerId = reservedTicket.userId;
            const creatorId = eventTx.creatorId;
            const amount = Number(reservedTicket.priceTokens || 0);
            const opId = `privrefund_finish_${String(reservedTicket._id)}`;

            const alreadyRefundedByTicket = String(reservedTicket.status) === "refunded";

            const existingRefund = await TokenTransaction.findOne({
              opId,
              kind: "ticket_refund",
              direction: "credit",
              fromUserId: creatorId,
              toUserId: buyerId,
            }).session(finishSession);

            const alreadyRefunded = alreadyRefundedByTicket || !!existingRefund;

            if (!alreadyRefunded && amount > 0) {
              const origDebit = await TokenTransaction.findOne({
                kind: "private_purchase",
                direction: "debit",
                eventId: eventTx._id,
                scope: "private",
                roomId: ps.roomId,
                fromUserId: buyerId,
                toUserId: creatorId,
                amountTokens: amount,
              })
                .sort({ createdAt: -1 })
                .session(finishSession);

              const buyerBuckets = (origDebit?.metadata && origDebit.metadata.buyerBuckets) || null;
              const usedFromEarnings = Number(buyerBuckets?.earnings || 0);
              const usedFromRedeemable = Number(buyerBuckets?.redeemable || 0);

              const incBuyer = { tokenBalance: amount };
              if (usedFromEarnings > 0) incBuyer.tokenEarnings = usedFromEarnings;
              if (usedFromRedeemable > 0) incBuyer.tokenRedeemable = usedFromRedeemable;

              await User.updateOne({ _id: buyerId }, { $inc: incBuyer }, { session: finishSession });

              const creatorBucketRaw = String(origDebit?.metadata?.creatorBucket || "").trim().toLowerCase();

              let creatorBucket = "earnings";
              if (creatorBucketRaw === "redeemable") creatorBucket = "redeemable";
              else if (creatorBucketRaw === "held") creatorBucket = "held";

              const decCreator = { tokenBalance: -amount };
              if (creatorBucket === "redeemable") decCreator.tokenRedeemable = -amount;
              else if (creatorBucket === "held") decCreator.tokenHeld = -amount;
              else decCreator.tokenEarnings = -amount;

              await User.updateOne({ _id: creatorId }, { $inc: decCreator }, { session: finishSession });

              const groupId = `grp_${crypto.randomUUID()}`;

              await TokenTransaction.insertMany(
                [
                  {
                    opId,
                    groupId,
                    fromUserId: creatorId,
                    toUserId: buyerId,
                    kind: "ticket_refund",
                    direction: "credit",
                    context: "ticket",
                    contextId: String(eventTx._id),
                    amountTokens: amount,
                    amountEuro: 0,
                    eventId: eventTx._id,
                    scope: "private",
                    roomId: ps.roomId,
                    metadata: {
                      reason: "EVENT_FINISHED_DURING_PRIVATE_RESERVED",
                      originalOpId: origDebit?.opId || null,
                      buyerBuckets: { earnings: usedFromEarnings, redeemable: usedFromRedeemable },
                      creatorBucket,
                    },
                  },
                  {
                    opId,
                    groupId,
                    fromUserId: creatorId,
                    toUserId: buyerId,
                    kind: "ticket_refund",
                    direction: "debit",
                    context: "ticket",
                    contextId: String(eventTx._id),
                    amountTokens: amount,
                    amountEuro: 0,
                    eventId: eventTx._id,
                    scope: "private",
                    roomId: ps.roomId,
                    metadata: {
                      reason: "EVENT_FINISHED_DURING_PRIVATE_RESERVED",
                      originalOpId: origDebit?.opId || null,
                    },
                  },
                ],
                { session: finishSession, ordered: true }
              );

              reservedTicket.status = "refunded";
              reservedTicket.refundedAt = now;
              await reservedTicket.save({ session: finishSession });

              refundedPrivateBuyerIds.push(String(buyerId));
            }
          }
        }

        // Native private paid → post-live hold window (24h)
        if (isPaidNativePrivate) {
          if (!eventTx.privateSession) eventTx.privateSession = {};

          if (!eventTx.privateSession.economicHeldAt) {
            eventTx.privateSession.economicHeldAt = now;
          }

          if (!Number.isFinite(Number(eventTx.privateSession.economicHeldTokens))) {
            eventTx.privateSession.economicHeldTokens = 0;
          }

          eventTx.privateSession.economicStatus = "held";
          eventTx.privateSession.economicReleaseEligibleAt = new Date(now.getTime() + HOLD_WINDOW_MS);
          eventTx.privateSession.economicReleasedAt = null;
          eventTx.privateSession.economicFrozenAt = null;
          eventTx.privateSession.economicRefundedAt = null;
          eventTx.privateSession.economicResolutionReason = "AWAITING_POST_EVENT_WINDOW";
        }

        eventTx.status = "finished";
        eventTx.live = {
          ...(eventTx.live || {}),
          endedAt: now,
        };

        if (eventTx.privateSession) {
          if (isInternalPrivate) {
            if (["scheduled", "reserved", "running"].includes(String(eventTx.privateSession.status || "idle"))) {
              eventTx.privateSession.status = "completed";
              eventTx.privateSession.countdownSeconds = 0;
              eventTx.privateSession.reservedByUserId = null;
              eventTx.privateSession.reservedAt = null;
              eventTx.privateSession.reservedExpiresAt = null;
              eventTx.privateSession.reservedPriceTokens = null;
              eventTx.privateSession.reservedDescription = null;
            }
          } else {
            eventTx.privateSession.status = "completed";
            eventTx.privateSession.countdownSeconds = 0;
            eventTx.privateSession.reservedByUserId = null;
            eventTx.privateSession.reservedAt = null;
            eventTx.privateSession.reservedExpiresAt = null;
            eventTx.privateSession.reservedPriceTokens = null;
            eventTx.privateSession.reservedDescription = null;
          }
        }

        await eventTx.save({ session: finishSession });

        await LiveRoom.updateMany(
          { eventId: eventTx._id, scope: { $in: ["public", "private"] } },
          { $set: { status: "ended" } },
          { session: finishSession }
        );

        Object.assign(event, eventTx.toObject());
      });
    } catch (e) {
      if (e && e.httpStatus && e.payload) {
        return res.status(e.httpStatus).json(e.payload);
      }
      throw e;
    } finally {
      finishSession.endSession();
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
      console.error("RESET_RUNTIME_ON_FINISH_FAILED", e?.message || e);
    }

    // 🔻 Disable any ADV linked to this event (best-effort)
    try {
      await Adv.updateMany(
        { targetType: "event", targetId: event._id, isActive: true },
        { $set: { isActive: false } }
      );
    } catch (e) {
      console.error("ADV_DISABLE_ON_FINISH_FAILED", e?.message || e);
    }

    // refund notification best-effort per eventuale buyer rimborsato
    if (refundedPrivateBuyerIds.length > 0) {
      try {
        for (const uid of refundedPrivateBuyerIds) {
          await Notification.updateOne(
            { dedupeKey: `ticket_refunded_finish_private:${event._id.toString()}:${uid}` },
            {
              $setOnInsert: {
                userId: uid,
                actorId: event.creatorId,
                type: "TICKET_REFUNDED",
                targetType: "event",
                targetId: event._id,
                message: "Private ticket refunded because the event ended before private session start",
                isPersistent: true,
                data: {
                  eventId: event._id,
                  refundedAt: new Date(),
                  reason: "EVENT_FINISHED_DURING_PRIVATE_RESERVED",
                },
                dedupeKey: `ticket_refunded_finish_private:${event._id.toString()}:${uid}`,
              },
            },
            { upsert: true }
          );
        }
      } catch (e) {
        console.error("PRIVATE_RESERVED_REFUND_NOTIFY_FAILED", e?.message || e);
      }
    }

    if (isNativePrivateEvent(event)) {
      try {
        const nativePrivateRoomId = event.privateSession?.roomId || `${event._id.toString()}_p0`;
        const privateBuyerIds = await getPrivateTicketUserIds(event._id, nativePrivateRoomId);

        if (privateBuyerIds.length > 0) {
          await createNotifForUsers({
            userIds: privateBuyerIds,
            actorId: event.creatorId,
            type: "EVENT_FINISHED",
            targetType: "event",
            targetId: event._id,
            message: "This private event has ended. Payment is temporarily held for review.",
            data: {
              eventId: event._id,
              scope: "private",
              roomId: nativePrivateRoomId,
              economicStatus: event.privateSession?.economicStatus || "held",
              releaseEligibleAt: event.privateSession?.economicReleaseEligibleAt || null,
            },
            dedupeBase: `event_finished_private:${event._id.toString()}:held_window`,
          });
        }
      } catch (e) {
        console.error("EVENT_FINISHED_NATIVE_PRIVATE_NOTIFY_FAILED", e?.message || e);
      }
    }

    return res.status(200).json({
      status: "success",
      message: "Event closed correctly",
      data: {
        id: event._id,
        status: event.status,
        live: event.live || null,
        privateEconomic: isNativePrivateEvent(event)
          ? {
              status: event.privateSession?.economicStatus || "none",
              releaseEligibleAt: event.privateSession?.economicReleaseEligibleAt || null,
            }
          : undefined,
      },
    });
  } catch (err) {
    console.error("Error closing event:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while closing the event",
    });
  }
});

/**
 * @route   POST /api/events/:id/cancel
 * @desc    Cancella un evento NON ancora iniziato e rimborsa i token ai partecipanti
 * @access  Private (solo creator)
 */
router.post("/:id/cancel", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    const eventId = req.params.id;

    if (!eventId || eventId.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Invalid event ID",
      });
    }

    const event = await Event.findById(eventId).exec();

    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    // Solo il creator può cancellare
    if (event.creatorId.toString() !== user._id.toString()) {
      return res.status(403).json({
        status: "error",
        message: "Only host of the event can cancel it",
      });
    }

    // Se è già cancellato, NON facciamo nulla (idempotente)
    if (event.status === "cancelled") {
      return res.status(200).json({
        status: "success",
        message: "Event already cancelled, no additional refund executed",
        data: {
          eventId: event._id,
          status: event.status,
        },
      });
    }

    // NON permettiamo di cancellare eventi già iniziati o terminati
    if (event.status !== "scheduled") {
      return res.status(400).json({
        status: "error",
        message:
          "You can't cancel an event that has already started or ended. Use finish to close it.",
        data: {
          eventId: event._id,
          status: event.status,
        },
      });
    }

    // 1️⃣ CANCEL + REFUND (ATOMICO via session.withTransaction)
    const session = await mongoose.startSession();

    let activeTickets = [];
    let refundMap = new Map(); // userId(string) -> refundAmount(number)
    let totalRefundedTokens = 0;
    let refundedUsersCount = 0;

    try {
      await session.withTransaction(async () => {
        // (A) ricarico evento in sessione
        const eventTx = await Event.findById(eventId).session(session).exec();
        if (!eventTx) {
          const err = new Error("Event not found");
          err.httpStatus = 404;
          err.payload = { status: "error", message: "Event not found" };
          throw err;
        }

        // idempotente dentro TX
        if (eventTx.status === "cancelled") {
          return;
        }

        if (eventTx.status !== "scheduled") {
          const err = new Error("You can't cancel an event that has already started or ended");
          err.httpStatus = 400;
          err.payload = {
            status: "error",
            message: "You can't cancel an event that has already started or ended. Use finish to close it.",
            data: { eventId: eventTx._id, status: eventTx.status },
          };
          throw err;
        }

        // (B) ticket attivi
        activeTickets = await Ticket.find({ eventId: eventTx._id, status: "active" })
          .session(session)
          .exec();

        // Nessun ticket → annullo solo evento
        if (activeTickets.length === 0) {
          eventTx.status = "cancelled";
          eventTx.totalTokensEarned = 0;
          eventTx.creatorShareTokens = 0;
          eventTx.platformShareTokens = 0;
          await eventTx.save({ session });

          refundedUsersCount = 0;
          totalRefundedTokens = 0;
          refundMap = new Map();
          return;
        }

        // (C) calcolo refund per utente
        refundMap = new Map();
        totalRefundedTokens = 0;

        for (const ticket of activeTickets) {
          const userIdStr = ticket.userId.toString();
          const amount = Number(ticket.priceTokens) || 0;
          const prev = refundMap.get(userIdStr) || 0;
          refundMap.set(userIdStr, prev + amount);
          totalRefundedTokens += amount;
        }

        const userIds = Array.from(refundMap.keys());
        refundedUsersCount = userIds.length;

        const now = new Date();

        // (D) refund ticket-by-ticket con ripristino bucket reale
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

            // refund buyer
            const incBuyer = { tokenBalance: amount };
            if (usedFromEarnings > 0) incBuyer.tokenEarnings = usedFromEarnings;
            if (usedFromRedeemable > 0) incBuyer.tokenRedeemable = usedFromRedeemable;

            await User.updateOne(
              { _id: buyerId },
              { $inc: incBuyer },
              { session }
            );

            // reverse creator
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
                    reason: "EVENT_CANCELLED",
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
                    reason: "EVENT_CANCELLED",
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

        // (G) cancel event + zero economics
        eventTx.status = "cancelled";
        eventTx.totalTokensEarned = 0;
        eventTx.creatorShareTokens = 0;
        eventTx.platformShareTokens = 0;

        if (isNativePrivateEvent(eventTx)) {
          if (!eventTx.privateSession) eventTx.privateSession = {};
          eventTx.privateSession.economicStatus = "refunded";
          eventTx.privateSession.economicHeldTokens = 0;
          eventTx.privateSession.economicRefundedAt = now;
          eventTx.privateSession.economicResolutionReason = "EVENT_CANCELLED";
        }

        await eventTx.save({ session });
      });

    } catch (e) {
      if (e && e.httpStatus && e.payload) {
        return res.status(e.httpStatus).json(e.payload);
      }
      console.error("EVENT_CANCEL_TX_FAILED", { msg: e?.message, name: e?.name, code: e?.code });
      throw e;
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

    // 🔻 Disable any ADV linked to this event (best-effort)
    try {
      await Adv.updateMany(
        { targetType: "event", targetId: event._id, isActive: true },
        { $set: { isActive: false } }
      );
    } catch (e) {
      console.error("ADV_DISABLE_ON_CANCEL_FAILED", e?.message || e);
    }

    // =========================
    //  NOTIF: REFUND (BEST-EFFORT + DEDUPE)
    // =========================
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

    // =========================
    //  NOTIF: EVENT_CANCELLED (BEST-EFFORT + DEDUPE)
    // =========================
    try {
      if (activeTickets.length > 0) {
        const uniqueUserIds = Array.from(
          new Set(activeTickets.map(t => t.userId?.toString()).filter(Boolean))
        );

        if (uniqueUserIds.length > 0) {
          const notifOps = uniqueUserIds.map((uid) => ({
            updateOne: {
              filter: { dedupeKey: `event_cancelled:${event._id.toString()}:${uid}` },
              update: {
                $setOnInsert: {
                  userId: uid,
                  actorId: event.creatorId,           // host che cancella
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
      // NON bloccare cancel
    }

    return res.status(200).json({
      status: "success",
      message: "Event cancelled and tokens refunded to participants",
      data: {
        eventId: event._id,
        status: event.status,
        refundedUsersCount,
        totalRefundedTokens,
      },
    });
  } catch (err) {
    console.error("Error during event cancellation with refund:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during event cancellation",
    });
  }
});

/**
 * @route   POST /api/events/:id/mute-viewer
 * @desc    Muta la chat per uno spettatore in questo evento
 * @access  Private (solo creator evento)
 *
 * Body:
 *  { "userId": "<id_utente_da_mutare>" }
 */
// Muta / smuta un singolo spettatore per l'evento
// Muta singolo spettatore
router.post("/:id/mute-viewer", auth, async (req, res) => {
  try {
    const eventId = req.params.id;
    const { userId } = req.body; // spettatore da mutare

    if (!userId) {
      return res.status(400).json({
        status: "error",
        message: "userId missing in body",
      });
    }

    const event = await Event.findById(eventId).exec();
    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    // Solo il creator può mutare
    if (event.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: "error",
        message: "Only host can mute viewers",
      });
    }

    // Inizializza array ROOT
    if (!Array.isArray(event.mutedUserIds)) {
      event.mutedUserIds = [];
    }

    const targetIdStr = userId.toString();
    const alreadyIndex = event.mutedUserIds.findIndex(
      (id) => id.toString() === targetIdStr
    );

    if (alreadyIndex === -1) {
      event.mutedUserIds.push(userId);
    }

    await event.save();

    return res.status(200).json({
      status: "success",
      message: "User muted successfully for this event",
      data: {
        eventId: event._id,
        mutedUserIds: event.mutedUserIds,
        targetUserId: userId,
        isMuted: true,
        mutedCount: event.mutedUserIds.length,
      },
    });
  } catch (err) {
    console.error("Error during mute-viewer event:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during viewer muting",
    });
  }
});

/**
 * @route   POST /api/events/:id/unmute-viewer
 * @desc    Smuuta la chat per uno spettatore in questo evento
 * @access  Private (solo creator evento)
 *
 * Body:
 *  { "userId": "<id_utente_da_mutare>" }
 */
// Smuta singolo spettatore
router.post("/:id/unmute-viewer", auth, async (req, res) => {
  try {
    const eventId = req.params.id;
    const { userId } = req.body; // spettatore da smutare

    if (!userId) {
      return res.status(400).json({
        status: "error",
        message: "userId missing in body",
      });
    }

    const event = await Event.findById(eventId).exec();
    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    // Solo il creator può smutare
    if (event.creatorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: "error",
        message: "Only host can unmute viewers",
      });
    }

    if (!Array.isArray(event.mutedUserIds)) {
      event.mutedUserIds = [];
    }

    const targetIdStr = userId.toString();
    event.mutedUserIds = event.mutedUserIds.filter(
      (id) => id.toString() !== targetIdStr
    );

    await event.save();

    return res.status(200).json({
      status: "success",
      message: "User unmuted successfully for this event",
      data: {
        eventId: event._id,
        mutedUserIds: event.mutedUserIds,
        targetUserId: userId,
        isMuted: false,
        mutedCount: event.mutedUserIds.length,
      },
    });
  } catch (err) {
    console.error("Error during unmute-viewer event:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during viewer unmuting",
    });
  }
});

/**
 * @route   POST /api/events/:id/chat-toggle
 * @desc    Creator abilita/disabilita la chat per gli spettatori
 * @access  Private (solo creator evento)
 *
 * Body opzionale:
 *  { "enableForViewers": true }  // per impostare esplicitamente
 *  { "enableForViewers": false }
 * Se il body manca, viene fatto toggle (true -> false / false -> true)
 */
router.post("/:id/chat-toggle", auth, async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "User not authenticated",
      });
    }

    const eventId = req.params.id;

    if (!eventId || eventId.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Invalid event ID",
      });
    }

    const event = await Event.findById(eventId).exec();

    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    // Solo il creator può cambiare lo stato della chat
    if (event.creatorId.toString() !== user._id.toString()) {
      return res.status(403).json({
        status: "error",
        message: "Only host of the event can modify chat",
      });
    }

    // Chat modificabile solo se evento non è cancellato/finito
    if (event.status === "cancelled" || event.status === "finished") {
      return res.status(400).json({
        status: "error",
        code: "EVENT_CLOSED",
        message:
          "It is not possible to edit chat on cancelled or finished events",
        data: {
          eventStatus: event.status,
        },
      });
    }

    const current =
      typeof event.chatEnabledForViewers === "boolean"
        ? event.chatEnabledForViewers
        : true;

    let newValue;

    if (typeof req.body.enableForViewers === "boolean") {
      newValue = req.body.enableForViewers;
    } else {
      newValue = !current;
    }

    event.chatEnabledForViewers = newValue;
    await event.save();

    return res.status(200).json({
      status: "success",
      message: newValue
        ? "Chat for viewers enabled"
        : "Chat for viewers disabled",
      data: {
        eventId: event._id,
        eventStatus: event.status,
        live: {
          chatEnabledForViewers: newValue,
        },
      },
    });
  } catch (err) {
    console.error("Error during chat-toggle event:", err);
    return res.status(500).json({
      status: "error",
      message:
        "Internal error during chat settings modification",
    });
  }
});

/**
 * @route   GET /api/events/feed
 * @desc    Feed eventi (public), con filtri base
 * @access  Public (in v1)
 *
 * Query:
 *  - filter = "upcoming" | "live" | "past" (default: "upcoming")
 *  - category = string
 *  - language = string (es. "it", "en")
 */
router.get("/feed", auth, featureGuard("live"), async (req, res) => {
  try {
    const { filter, category, language } = req.query;
    const now = new Date();
    // pagination (standard)
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limitRaw = parseInt(req.query.limit, 10) || 20;
    const limit = Math.min(Math.max(limitRaw, 1), 50); // clamp 1..50
    const skip = (page - 1) * limit;

    // 1) prendo gli utenti mutati
    const mutedUserIds = await getMutedUserIds(req.user._id);
    // 1b) prendo gli utenti bloccati (both sides)
    const blockedUserIds = await getBlockedUserIds(req.user._id);

    const query = {
      visibility: { $ne: "unlisted" },
      creatorId: { $nin: [...mutedUserIds, ...blockedUserIds] },
    };

    // Filtro per stato
    if (filter === "live") {
      query.status = "live";
    } else if (filter === "past") {
      query.status = "finished";
    } else {
      // default: upcoming
      query.status = "scheduled";
      query.startTime = { $gte: now };
    }

    // Filtro categoria
    if (category) query.category = category;

    // Filtro lingua: SOLO VIP
    if (language && req.user?.isVip === true) {
      query.language = String(language).trim().toLowerCase();
    }

    // Ordine: upcoming by startTime asc, live/past per startTime desc
    let sort = { startTime: 1 };
    if (filter === "live" || filter === "past") sort = { startTime: -1 };

    const events = await Event.find(query)
      .select("-language -area -targetProfileType")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate({
        path: "creatorId",
        select: "displayName avatar accountType role",
      })
      .exec();

    const result = events.map((event) => ({
      id: event._id,
      title: event.title,
      description: event.description,
      category: event.category,
      coverImage: event.coverImage,
      startTime: event.startTime,
      durationMinutes: event.durationMinutes,
      ticketPriceTokens: event.ticketPriceTokens,
      status: event.status,
      ticketsSoldCount: event.ticketsSoldCount,
      maxSeats: event.maxSeats,
      interactionMode: event.interactionMode,
      chatEnabledForViewers: event.chatEnabledForViewers,
      likesCount: event.likesCount || 0,
      creator: event.creatorId
        ? {
            id: event.creatorId._id,
            displayName: event.creatorId.displayName,
            avatar: event.creatorId.avatar,
            accountType: event.creatorId.accountType || event.creatorId.role || null,
          }
        : null,
    }));

    return res.status(200).json({
      status: "success",
      data: result,
      meta: {
        page,
        limit,
        returned: result.length,
      },
    });
  } catch (err) {
    console.error("Event feed error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while retrieving event feed",
    });
  }
});

/**
 * @route   GET /api/events/my-created
 * @desc    Lista eventi creati dall'utente (tipicamente creator)
 * @access  Private
 *
 * Query opzionale:
 *  - status = "scheduled" | "live" | "finished" | "cancelled"
 */
router.get("/my-created", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "User not authenticated",
      });
    }

    const statusFilter = req.query.status;

    const query = {
      creatorId: user._id,
    };

    if (statusFilter) {
      query.status = statusFilter;
    }

    const events = await Event.find(query)
      .select("-language -area -targetProfileType")
      .sort({ startTime: -1 })
      .exec();

    const result = events.map((event) => ({
      id: event._id,
      title: event.title,
      description: event.description,
      category: event.category,
      coverImage: event.coverImage,
      startTime: event.startTime,
      durationMinutes: event.durationMinutes,
      ticketPriceTokens: event.ticketPriceTokens,
      status: event.status,
      ticketsSoldCount: event.ticketsSoldCount,
      maxSeats: event.maxSeats,
      interactionMode: event.interactionMode,
      chatEnabledForViewers: event.chatEnabledForViewers,
      totalTokensEarned: event.totalTokensEarned,
      creatorShareTokens: event.creatorShareTokens,
      platformShareTokens: event.platformShareTokens,
      soldOutInterestCount: event.soldOutInterestCount || 0,
    }));

    return res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (err) {
    console.error("Error retrieving user-created events:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while retrieving user-created events",
    });
  }
});

router.get("/:id/access", auth, featureGuard("live"), async (req, res) => {
  try {
    const eventId = req.params.id;
    const userId = req.user._id;

    const event = await Event.findById(eventId).exec();
    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    const requestedScope =
      String(req.query?.scope || "public").trim().toLowerCase() === "private"
        ? "private"
        : "public";

    const result = await checkEventAccess({
      event,
      userId,
      requestedScope,
      accountType: getAccountTypeFromUser(req.user),
    });

    console.log("ACCESS RESULT", result);

    return res.status(200).json({
      status: "success",
      data: {
        eventId: event._id,
        eventStatus: event.status,
        ...result,
      },
    });
  } catch (err) {
    console.error("Event access error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while verifying event access",
    });
  }
});

/**
 * @route   GET /api/events/my-tickets
 * @desc    Lista eventi per cui l'utente loggato ha un ticket
 * @access  Private
 */
router.get("/my-tickets", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ status: "error", message: "User not authenticated" });
    }

    // 1) prendo tutti i ticket attivi dell’utente (public + private)
    const tickets = await Ticket.find({
      userId: user._id,
      status: "active",
    })
      .select("eventId scope roomId purchasedAt")
      .lean();

    if (!tickets.length) {
      return res.status(200).json({ status: "success", data: [] });
    }

    const eventIds = Array.from(new Set(tickets.map(t => t.eventId.toString())));

    // 2) carico eventi collegati (solo scheduled/live come prima)
    const events = await Event.find({
      _id: { $in: eventIds },
      status: { $in: ["scheduled", "live"] },
    })
      .select("-language -area -targetProfileType")
      .sort({ startTime: 1 })
      .lean();

    // 3) mappa ticket per evento (se vuoi mostrarli in UI)
    const ticketsByEventId = new Map();
    for (const t of tickets) {
      const key = t.eventId.toString();
      if (!ticketsByEventId.has(key)) ticketsByEventId.set(key, []);
      ticketsByEventId.get(key).push({
        scope: t.scope,
        roomId: t.roomId || null,
        purchasedAt: t.purchasedAt || null,
      });
    }

    const result = events.map((event) => ({
      id: event._id,
      title: event.title,
      description: event.description,
      category: event.category,
      coverImage: event.coverImage,
      startTime: event.startTime,
      durationMinutes: event.durationMinutes,
      ticketPriceTokens: event.ticketPriceTokens,
      status: event.status,
      ticketsSoldCount: event.ticketsSoldCount,
      maxSeats: event.maxSeats,
      interactionMode: event.interactionMode,
      chatEnabledForViewers: event.chatEnabledForViewers,
      tickets: ticketsByEventId.get(event._id.toString()) || [],
    }));

    return res.status(200).json({ status: "success", data: result });
  } catch (err) {
    console.error("Error retrieving events with user ticket:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while retrieving user events",
    });
  }
});

/**
 * @route   GET /api/events/:id
 * @desc    Dettaglio evento
 * @access  Public (rispetta visibility, logica avanzata dopo)
 */
router.get("/:id", auth, featureGuard("live"), async (req, res) => {
  try {
    const eventId = req.params.id;

    // Basic validation ObjectId
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        status: "error",
        message: "Event ID not valid",
      });
    }

    const event = await Event.findById(eventId)
      .populate({
        path: "creatorId",
        // prendiamo più varianti perché nel DB i nomi possono differire
        select: "displayName username name avatar avatarUrl profileImage profilePicture accountType role",
      })
      .exec();

    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    // 🔒 BLOCK GUARD: se viewer e creator sono bloccati in qualunque direzione -> 403
    const meId = String(req.user._id);
    const creatorId = event.creatorId ? String(event.creatorId._id || event.creatorId) : null;

    if (creatorId) {
      const blocked = await isUserBlockedEitherSide(meId, creatorId);
      if (blocked) {
        return res.status(403).json({
          status: "error",
          code: "EVENT_BLOCKED",
          message: "Event not available",
        });
      }
    }

    const isOwner = String(event.creatorId?._id || event.creatorId) === String(req.user._id);

    if (event.visibility === "unlisted" && !isOwner) {
      return res.status(403).json({
        status: "error",
        code: "EVENT_UNLISTED",
        message: "Event not available",
      });
    }

    // ✅ AUTO-EXPIRE (reserved timeout) + refund (ANY VIEWER)
    // Idempotente via opId -> safe
    {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const evTx = await Event.findById(event._id).session(session).exec();
          if (!evTx) return;

          await expirePrivateReservationIfNeeded({ event: evTx, session });

          Object.assign(event, evTx.toObject());
          await event.populate({
            path: "creatorId",
            select: "displayName username name avatar avatarUrl profileImage profilePicture accountType role",
          });
        });
      } finally {
        session.endSession();
      }
    }
    
    const isNativePrivate = isNativePrivateEvent(event);
    const hasInternalPrivateLifecycle = isInternalPrivateAllowed(event);

    const privateSession = hasInternalPrivateLifecycle ? (event.privateSession || {}) : null;
    const isPrivateRunning = hasInternalPrivateLifecycle && privateSession?.status === "running";

    // In futuro qui aggiungeremo controlli su visibility (followers, unlisted, ecc.)

    // calcoli dinamici prima del return
    const max = Number(event.maxSeats || 0);
    const paid = Number(event.ticketPriceTokens || 0) > 0;
    const ticketsSold = Number(event.ticketsSoldCount || 0);
    const viewerCount = Number(event.viewerCount || 0);

    // 🔒 seatsRemaining basato SOLO sui biglietti venduti
    const seatsRemaining =
      paid && max > 0
        ? Math.max(0, max - ticketsSold)
        : null;

    // -----------------------------
    // PRIVATE totals (host-only): NET = purchases - refunds
    // -----------------------------
    let privateGrossTokens = 0;
    let privateRefundTokens = 0;
    let privateNetTokens = 0;

    if (isOwner) {
      const eventObjId = new mongoose.Types.ObjectId(event._id);

      const rows = await TokenTransaction.aggregate([
        {
          $match: {
            eventId: eventObjId,
            scope: "private",
            $or: [
              { kind: "private_purchase", direction: "debit" },
              { kind: "ticket_refund", direction: "credit" },
            ],
          },
        },
        {
          $group: {
            _id: null,
            gross: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ["$kind", "private_purchase"] }, { $eq: ["$direction", "debit"] }] },
                  "$amountTokens",
                  0,
                ],
              },
            },
            refund: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ["$kind", "ticket_refund"] }, { $eq: ["$direction", "credit"] }] },
                  "$amountTokens",
                  0,
                ],
              },
            },
          },
        },
      ]);

      const gross = Number(rows?.[0]?.gross || 0);
      const refund = Number(rows?.[0]?.refund || 0);

      privateGrossTokens = Number.isFinite(gross) ? Math.max(0, Math.floor(gross)) : 0;
      privateRefundTokens = Number.isFinite(refund) ? Math.max(0, Math.floor(refund)) : 0;

      const net = privateGrossTokens - privateRefundTokens;
      privateNetTokens = Number.isFinite(net) ? Math.max(0, Math.floor(net)) : 0;
    }

    return res.status(200).json({
      status: "success",
      data: {
        id: event._id,
        title: event.title,
        description: event.description,
        category: event.category,
        coverImage: event.coverImage,
        startTime: event.startTime,
        durationMinutes: event.durationMinutes,
        ticketPriceTokens: event.ticketPriceTokens,
        maxSeats: event.maxSeats,
        accessScope: event.accessScope, // modalità nativa di nascita dell'evento
        contentScope: event.contentScope, // HOT | NO_HOT
        viewerCount,
        seatsRemaining, 
        ticketsSoldCount: event.ticketsSoldCount,
        visibility: event.visibility,
        interactionMode: event.interactionMode,
        chatEnabledForViewers: event.chatEnabledForViewers,
        status: event.status,
        likesCount: event.likesCount || 0,
        soldOutInterestCount: event.soldOutInterestCount || 0,
        totalTokensEarned: event.totalTokensEarned,
        creatorShareTokens: event.creatorShareTokens,
        platformShareTokens: event.platformShareTokens,
        // GOAL (minimal for viewers)
        goal: {
          isActive: !!(event.goal?.isActive),
          targetTokens: Number(event.goal?.targetTokens || 0),
          progressTokens: Number(event.goal?.progressTokens || 0),
          title: String(event.goal?.title || ""),
          description: String(event.goal?.description || ""),
          reachedAt: event.goal?.reachedAt || null,
        },

        // tipTotalTokens visible ONLY to host
        tipTotalTokens: isOwner ? Number(event.tipTotalTokens || 0) : undefined,
        // privateTotalTokens (NET) visible ONLY to host
        privateTotalTokens: isOwner ? privateNetTokens : undefined,

        // (opzionale debug host-only)
        privateGrossTokens: isOwner ? privateGrossTokens : undefined,
        privateRefundTokens: isOwner ? privateRefundTokens : undefined,
        privateEconomic: isOwner && isNativePrivate
          ? {
              status: event.privateSession?.economicStatus || "none",
              heldTokens: Number(event.privateSession?.economicHeldTokens || 0),
              heldAt: event.privateSession?.economicHeldAt || null,
              releasedAt: event.privateSession?.economicReleasedAt || null,
              frozenAt: event.privateSession?.economicFrozenAt || null,
              refundedAt: event.privateSession?.economicRefundedAt || null,
              resolutionReason: event.privateSession?.economicResolutionReason || null,
            }
          : undefined,
        creator: event.creatorId
          ? (() => {
              const c = event.creatorId;

              const displayName =
                String(
                  c.displayName ||
                    c.username ||
                    c.name ||
                    ""
                ).trim();

              const avatar =
                String(
                  c.avatar ||
                    c.avatarUrl ||
                    c.profileImage ||
                    c.profilePicture ||
                    ""
                ).trim();

              return {
                id: c._id,
                displayName,
                avatar,
                accountType: c.accountType || c.role || null,
              };
            })()
          : null,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        privateSession: hasInternalPrivateLifecycle
          ? {
              isEnabled: !!privateSession.isEnabled,
              status: privateSession.status || "idle",
              seats: privateSession.seats || 0,
              description: String(privateSession.description || ""),
              countdownSeconds: isOwner ? (privateSession.countdownSeconds || 0) : 0,
              isPrivateRunning,
              roomId: privateSession.roomId || null,
              ticketPriceTokens:
                Number.isFinite(privateSession.ticketPriceTokens)
                  ? privateSession.ticketPriceTokens
                  : Number.isFinite(privateSession.reservedPriceTokens)
                    ? privateSession.reservedPriceTokens
                    : 0,
              reservedByUserId: privateSession.reservedByUserId || null,
              reservedExpiresAt: privateSession.reservedExpiresAt || null,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("Error reading event:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while retrieving the event",
    });
  }
});

/**
 * @route   POST /api/events/:id/ticket
 * @desc    Acquista un ticket per un evento
 * @access  Private (base, vip, creator) - ma non il creator dell'evento stesso
 */
router.post("/:id/ticket", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    const eventId = req.params.id;

    logTicketFlow("START", {
      route: "POST /api/events/:id/ticket",
      eventId: String(eventId || ""),
      buyerId: String(user?._id || ""),
      requestedScope: String(req.body?.scope || "public").trim().toLowerCase(),
    });

    if (!user) {
      return res.status(401).json({ status: "error", message: "User not authenticated" });
    }

    // 1) Recupero evento
    const event = await Event.findById(eventId).exec();
    if (!event) {
      logTicketFlow("ERROR", {
        route: "POST /api/events/:id/ticket",
        eventId: String(eventId || ""),
        buyerId: String(user?._id || ""),
        code: "EVENT_NOT_FOUND",
      });

      return res.status(404).json({ status: "error", message: "Event not found" });
    }

    // creator non può comprare
    if (event.creatorId.toString() === user._id.toString()) {
      logTicketFlow("ERROR", {
        route: "POST /api/events/:id/ticket",
        eventId: String(event._id || ""),
        buyerId: String(user?._id || ""),
        creatorId: String(event.creatorId || ""),
        code: "CREATOR_CANNOT_BUY_OWN_TICKET",
      });

      return res.status(403).json({
        status: "error",
        message: "The creator cannot purchase tickets for their evento",
      });
    }

    // unlisted: acquistabile solo dal creator (ma il creator non può comprare ticket),
    // quindi per chiunque altro è "non disponibile"
    if (event.visibility === "unlisted") {
      logTicketFlow("ERROR", {
        route: "POST /api/events/:id/ticket",
        eventId: String(event._id || ""),
        buyerId: String(user?._id || ""),
        creatorId: String(event.creatorId || ""),
        code: "EVENT_UNLISTED",
      });

      return res.status(403).json({
        status: "error",
        code: "EVENT_UNLISTED",
        message: "Event not available",
      });
    }

    // ✅ Scope effettivo: se l’evento nasce privato, forziamo private
    let scope = (req.body && req.body.scope === "private") ? "private" : "public";
    if (event.accessScope === "private") scope = "private";

    const isNativePrivateEvent = event.accessScope === "private";
    const isEmbeddedPrivateSession = !isNativePrivateEvent && scope === "private";
    // Economic protection target for Block 1:
    // hold funds only for native private paid events bought via /ticket
    const shouldHoldNativePrivateFunds = isNativePrivateEvent === true;    

    // blocco reciproco
    const isBlocked = await isUserBlockedEitherSide(String(user._id), String(event.creatorId));
    if (isBlocked) {
      logTicketFlow("ERROR", {
        route: "POST /api/events/:id/ticket",
        eventId: String(event._id || ""),
        buyerId: String(user?._id || ""),
        creatorId: String(event.creatorId || ""),
        code: "EVENT_BLOCKED",
      });

      return res.status(403).json({
        status: "error",
        code: "EVENT_BLOCKED",
        message: "Event not available",
      });
    }

    // evento non acquistabile
    if (event.status === "cancelled") {
      logTicketFlow("ERROR", {
        route: "POST /api/events/:id/ticket",
        eventId: String(event._id || ""),
        buyerId: String(user?._id || ""),
        creatorId: String(event.creatorId || ""),
        code: "EVENT_CANCELLED",
        eventStatus: String(event.status || ""),
      });

      return res.status(400).json({
        status: "error",
        code: "EVENT_CANCELLED",
        message: "Event cancelled",
      });
    }

    if (event.status === "finished") {
      logTicketFlow("ERROR", {
        route: "POST /api/events/:id/ticket",
        eventId: String(event._id || ""),
        buyerId: String(user?._id || ""),
        creatorId: String(event.creatorId || ""),
        code: "EVENT_FINISHED",
        eventStatus: String(event.status || ""),
      });

      return res.status(400).json({
        status: "error",
        code: "EVENT_FINISHED",
        message: "Event finished",
      });
    }

    // 3) Fonte di verità prezzi/capienza
    const privateSession = isEmbeddedPrivateSession ? event.privateSession : null;

    // Private interna dentro live public
    if (isEmbeddedPrivateSession) {
      if (!privateSession || privateSession.isEnabled !== true) {
        return res.status(400).json({
          status: "error",
          code: "PRIVATE_NOT_ACTIVE",
          message: "Private session not active",
        });
      }

      if (!["scheduled", "running"].includes(privateSession.status)) {
        return res.status(400).json({
          status: "error",
          code: "PRIVATE_NOT_AVAILABLE",
          message: "Private session not available",
        });
      }

      if (!privateSession.roomId) {
        return res.status(400).json({
          status: "error",
          code: "PRIVATE_INVALID_ROOM",
          message: "Private session not available",
        });
      }
    }

    // ✅ prezzo: supporta varianti campo (per non impazzire)
    const publicPrice = Number(event.ticketPriceTokens ?? event.ticketPriceToken ?? 0);
    const privatePrice = privateSession
      ? Number(privateSession.ticketPriceTokens ?? privateSession.ticketPriceToken ?? privateSession.priceTokens ?? 0)
      : 0;

    const priceTokens =
      isEmbeddedPrivateSession
        ? privatePrice
        : publicPrice;

    if (!Number.isFinite(priceTokens) || priceTokens < 0) {
      return res.status(400).json({
        status: "error",
        message: "Ticket price not valid",
        data: { scope, priceTokens },
      });
    }

    // PUBLIC gratis: ticket non richiesto
    if (scope === "public" && priceTokens === 0) {
      logTicketFlow("ERROR", {
        route: "POST /api/events/:id/ticket",
        eventId: String(event._id || ""),
        buyerId: String(user?._id || ""),
        creatorId: String(event.creatorId || ""),
        code: "FREE_PUBLIC_EVENT_NO_TICKET_REQUIRED",
        scope,
        priceTokens: Number(priceTokens || 0),
      });

      return res.status(400).json({
        status: "error",
        message: "Free public event: no ticket required",
        data: { requiresTicket: false, scope, priceTokens },
      });
    }

    // PRIVATE deve essere sempre a pagamento
    if (scope === "private" && priceTokens === 0) {
      logTicketFlow("ERROR", {
        route: "POST /api/events/:id/ticket",
        eventId: String(event._id || ""),
        buyerId: String(user?._id || ""),
        creatorId: String(event.creatorId || ""),
        code: "PRIVATE_TICKET_CANNOT_BE_FREE",
        scope,
        priceTokens: Number(priceTokens || 0),
      });

      return res.status(400).json({
        status: "error",
        message: isNativePrivateEvent
          ? "Private event cannot be free"
          : "Private session cannot be free",
        data: { scope, priceTokens },
      });
    }

    const roomId = isEmbeddedPrivateSession ? privateSession.roomId : null;

    // 4) Hai già il ticket?
    const ticketQuery = { eventId: event._id, userId: user._id, scope };
    if (isEmbeddedPrivateSession) ticketQuery.roomId = roomId;

    const existingTicket = await Ticket.findOne(ticketQuery).lean().exec();
    if (existingTicket) {
      logTicketFlow("SUCCESS", {
        route: "POST /api/events/:id/ticket",
        eventId: String(event._id || ""),
        buyerId: String(user?._id || ""),
        creatorId: String(event.creatorId || ""),
        scope: String(existingTicket.scope || scope || "public"),
        roomId: existingTicket.roomId ? String(existingTicket.roomId) : null,
        mode: "existing_ticket",
        ticketId: String(existingTicket._id || ""),
      });

      return res.status(200).json({
        status: "success",
        message: "You already have a ticket for this event",
        data: { ticketId: existingTicket._id, scope: existingTicket.scope, roomId: existingTicket.roomId || null },
      });
    }

    // 5) Limite posti: public -> event.maxSeats, private -> privateSession.seats
    const seatsLimit = isEmbeddedPrivateSession
      ? (Number(privateSession.seats) > 0 ? Number(privateSession.seats) : null)
      : (Number(event.maxSeats) > 0 ? Number(event.maxSeats) : null);

    if (seatsLimit !== null) {
      const countQuery = { eventId: event._id, scope };
      if (isEmbeddedPrivateSession) countQuery.roomId = roomId;

      const sold = await Ticket.countDocuments(countQuery);
      if (sold >= seatsLimit) {
        logTicketFlow("ERROR", {
          route: "POST /api/events/:id/ticket",
          eventId: String(event._id || ""),
          buyerId: String(user?._id || ""),
          creatorId: String(event.creatorId || ""),
          code: "SEATS_SOLD_OUT",
          scope,
          roomId: roomId || null,
          seatsLimit: Number(seatsLimit || 0),
          sold: Number(sold || 0),
        });

        return res.status(400).json({
          status: "error",
          code: "SEATS_SOLD_OUT",
          message: "Seats sold out for this event",
        });
      }
    }
    // =========================
    // BETA: TOKENS OFF => FREE TICKET (no ledger, no balance changes)
    // Condition: ECONOMY_ENABLED=false OR TOKENS_ENABLED=false
    // =========================
    if (!tokensRuntimeEnabled()) {
      logTicketFlow("ERROR", {
        route: "POST /api/events/:id/ticket",
        eventId: String(event._id || ""),
        buyerId: String(user?._id || ""),
        creatorId: String(event.creatorId || ""),
        code: "TOKENS_DISABLED",
        scope,
      });

      return res.status(403).json({
        status: "error",
        code: "TOKENS_DISABLED",
        message: "Ticket purchase is currently disabled",
      });
    }

    // =========================
    // 6) ADDEBITO TOKEN + TX + TICKET (ATOMICO via session.withTransaction)
    // =========================
    const TOKEN_FIELD = "tokenBalance"; // <-- se diverso, cambia QUI soltanto

    const session = await mongoose.startSession();

    const opIdRaw = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
    const opId =
      (typeof opIdRaw === "string" && opIdRaw.trim().length >= 8)
        ? opIdRaw.trim()
        : `ticket_${event._id.toString()}_${user._id.toString()}_${scope}_${roomId || "no_room"}_${crypto.randomUUID()}`;

    const groupId = `grp_${crypto.randomUUID()}`;

    let savedTicket = null;
    let debit = null;
    let purchaseMode = "new_purchase";

    try {
      await session.withTransaction(async () => {
        // (A) Anti-double spend: ricontrollo ticket dentro la transazione
        const txTicketQuery = { eventId: event._id, userId: user._id, scope };
        if (isEmbeddedPrivateSession) txTicketQuery.roomId = roomId;

        const existingTicketInTx = await Ticket.findOne(txTicketQuery).session(session).exec();
        if (existingTicketInTx) {
          savedTicket = existingTicketInTx;
          purchaseMode = "existing_ticket_tx";
          return;
        }

        // (B) Ricontrollo capienza dentro la transazione
        const seatsLimitTx = (scope === "private")
          ? (Number(privateSession?.seats) > 0 ? Number(privateSession.seats) : null)
          : (Number(event.maxSeats) > 0 ? Number(event.maxSeats) : null);

        if (seatsLimitTx !== null) {
          const countQueryTx = { eventId: event._id, scope };
          if (isEmbeddedPrivateSession) countQueryTx.roomId = roomId;

          const soldTicketsTx = await Ticket.countDocuments(countQueryTx).session(session);
          if (soldTicketsTx >= seatsLimitTx) {
            logTicketFlow("ERROR", {
              route: "POST /api/events/:id/ticket",
              eventId: String(event._id || ""),
              buyerId: String(user?._id || ""),
              creatorId: String(event.creatorId || ""),
              code: "SEATS_SOLD_OUT_TX",
              scope,
              roomId: roomId || null,
              seatsLimit: Number(seatsLimitTx || 0),
              sold: Number(soldTicketsTx || 0),
            });

            const err = new Error("This event is sold out.");
            err.httpStatus = 400;
            err.payload = { status: "error", message: "This event is sold out." };
            throw err;
          }
        }

        // (C) IDEMPOTENCY GUARD PRIMA DI QUALSIASI DEBIT
        const existingDebitTx = await TokenTransaction.findOne({
          opId,
          kind: "ticket_purchase",
          direction: "debit",
          eventId: event._id,
          scope,
          roomId: roomId || null,
          fromUserId: user._id,
          toUserId: event.creatorId,
        }).session(session);

        if (existingDebitTx) {
          let rebuiltTicket = await Ticket.findOne(txTicketQuery).session(session).exec();

          if (!rebuiltTicket) {
            rebuiltTicket = await Ticket.create([{
              eventId: event._id,
              userId: user._id,
              scope,
              roomId,
              priceTokens,
              purchasedAt: new Date(),
              status: "active",
            }], { session }).then((docs) => docs?.[0] || null);

            if (scope === "public") {
              await Event.updateOne(
                { _id: event._id },
                { $inc: { ticketsSoldCount: 1 } },
                { session }
              );
            }
          }

          savedTicket = rebuiltTicket;
          purchaseMode = "idempotent_replay";
          return;
        }

        // (D) Addebito token
        debit = await debitUserTokensBuckets({
          userId: user._id,
          amountTokens: priceTokens,
          session,
        });

        if (!debit.ok) {
          logTicketFlow("ERROR", {
            route: "POST /api/events/:id/ticket",
            eventId: String(event._id || ""),
            buyerId: String(user?._id || ""),
            creatorId: String(event.creatorId || ""),
            code: debit.code || "INSUFFICIENT_TOKENS",
            scope,
            roomId: roomId || null,
            priceTokens: Number(priceTokens || 0),
            opId,
          });

          const err = new Error("Insufficient tokens");
          err.httpStatus = 400;
          err.payload = {
            status: "error",
            code: debit.code,
            message: "Insufficient tokens",
            data: { scope, priceTokens },
          };
          throw err;
        }

        // (E) Credit to creator
        const creator = await User.findById(event.creatorId)
          .select("_id accountType isCreator creatorEnabled creatorVerification tokenBalance tokenEarnings tokenRedeemable tokenHeld isVip")
          .session(session);

        if (!creator) {
          logTicketFlow("ERROR", {
            route: "POST /api/events/:id/ticket",
            eventId: String(event._id || ""),
            buyerId: String(user?._id || ""),
            creatorId: String(event.creatorId || ""),
            code: "CREATOR_NOT_FOUND",
            scope,
            roomId: roomId || null,
            priceTokens: Number(priceTokens || 0),
            opId,
          });

          const err = new Error("Creator not found");
          err.httpStatus = 404;
          err.payload = { status: "error", message: "Creator not found" };
          throw err;
        }

        const isCreatorVerified =
          (creator.accountType === "creator" || creator.isCreator === true) &&
          creator.creatorEnabled === true &&
          creator.creatorVerification?.status === "approved";

        let goesToEarnings = false;
        let creatorBucket = "redeemable";
        let releaseTargetBucket = isCreatorVerified ? "redeemable" : "earnings";

        if (shouldHoldNativePrivateFunds) {
          await User.updateOne(
            { _id: event.creatorId },
            { $inc: { tokenBalance: priceTokens, tokenHeld: priceTokens } },
            { session }
          );

          creatorBucket = "held";
          goesToEarnings = false;
          releaseTargetBucket = isCreatorVerified ? "redeemable" : "earnings";
        } else {
          const inc = { tokenBalance: priceTokens };
          if (isCreatorVerified) {
            inc.tokenRedeemable = priceTokens;
            creatorBucket = "redeemable";
            goesToEarnings = false;
          } else {
            inc.tokenEarnings = priceTokens;
            creatorBucket = "earnings";
            goesToEarnings = true;
          }

          await User.updateOne({ _id: event.creatorId }, { $inc: inc }, { session });
        }

        // (F) Ledger atomico
        await TokenTransaction.insertMany(
          [
            {
              opId,
              groupId,
              fromUserId: user._id,
              toUserId: event.creatorId,
              kind: "ticket_purchase",
              direction: "debit",
              context: "ticket",
              contextId: String(event._id),
              amountTokens: priceTokens,
              amountEuro: 0,
              eventId: event._id,
              scope,
              roomId: roomId || null,
              metadata: {
                goesToEarnings,
                buyerBuckets: {
                  earnings: debit.usedFromEarnings,
                  redeemable: debit.usedFromRedeemable,
                },
                creatorBucket,
                releaseTargetBucket,
                privateFundsStatus: creatorBucket === "held" ? "held" : undefined,
              },
            },
            {
              opId,
              groupId,
              fromUserId: user._id,
              toUserId: event.creatorId,
              kind: "ticket_purchase",
              direction: "credit",
              context: "ticket",
              contextId: String(event._id),
              amountTokens: priceTokens,
              amountEuro: 0,
              eventId: event._id,
              scope,
              roomId: roomId || null,
              metadata: {
                goesToEarnings,
                creatorBucket,
                releaseTargetBucket,
                privateFundsStatus: creatorBucket === "held" ? "held" : undefined,
              },
            },
          ],
          { session, ordered: true }
        );

        // (G) Creazione ticket
        const ticket = new Ticket({
          eventId: event._id,
          userId: user._id,
          scope,
          roomId,
          priceTokens,
          purchasedAt: new Date(),
          status: "active",
        });

        // (H) Increment counters solo PUBLIC
        if (scope === "public") {
          await Event.updateOne(
            { _id: event._id },
            { $inc: { ticketsSoldCount: 1 } },
            { session }
          );
        }

        savedTicket = await ticket.save({ session });
        purchaseMode = "new_purchase";
        if (shouldHoldNativePrivateFunds) {
          await Event.updateOne(
            { _id: event._id },
            {
              $set: {
                "privateSession.economicStatus": "held",
                "privateSession.economicHeldAt": new Date(),
                "privateSession.economicReleasedAt": null,
                "privateSession.economicFrozenAt": null,
                "privateSession.economicRefundedAt": null,
                "privateSession.economicResolutionReason": "NATIVE_PRIVATE_TICKET_PURCHASED",
              },
              $inc: {
                "privateSession.economicHeldTokens": priceTokens,
              },
            },
            { session }
          );
        }
      });

      if (savedTicket && savedTicket._id && !debit && purchaseMode === "existing_ticket_tx") {
        logTicketFlow("SUCCESS", {
          route: "POST /api/events/:id/ticket",
          eventId: String(event._id || ""),
          buyerId: String(user?._id || ""),
          creatorId: String(event.creatorId || ""),
          scope: String(savedTicket.scope || scope || "public"),
          roomId: savedTicket.roomId ? String(savedTicket.roomId) : null,
          mode: "existing_ticket_tx",
          ticketId: String(savedTicket._id || ""),
          opId,
        });

        return res.status(200).json({
          status: "success",
          message: "You already have a ticket for this event",
          data: {
            ticketId: savedTicket._id,
            scope: savedTicket.scope,
            roomId: savedTicket.roomId || null,
          },
        });
      }

      if (savedTicket && savedTicket._id && !debit && purchaseMode === "idempotent_replay") {
        logTicketFlow("SUCCESS", {
          route: "POST /api/events/:id/ticket",
          eventId: String(event._id || ""),
          buyerId: String(user?._id || ""),
          creatorId: String(event.creatorId || ""),
          scope: String(savedTicket.scope || scope || "public"),
          roomId: savedTicket.roomId ? String(savedTicket.roomId) : null,
          mode: "idempotent_replay",
          ticketId: String(savedTicket._id || ""),
          opId,
          groupId,
        });

        return res.status(200).json({
          status: "success",
          message: "Ticket purchase already processed",
          data: {
            ticketId: savedTicket._id,
            eventId: event._id,
            userId: user._id,
            scope: savedTicket.scope,
            roomId: savedTicket.roomId || null,
            priceTokens,
            replayed: true,
          },
        });
      }

    } catch (e) {
      // errori “controllati” con payload
      if (e && e.httpStatus && e.payload) {
        return res.status(e.httpStatus).json(e.payload);
      }

      console.error("TICKET_PURCHASE_TX_FAILED", {
        msg: e?.message,
        name: e?.name,
        code: e?.code,
      });

      throw e; // va nel catch esterno -> 500
    } finally {
      session.endSession();
    }

    // =========================
    // 9) NOTIFICHE (BEST-EFFORT)
    // =========================
    try {
      const scopeKey = scope === "private" ? (roomId || "private") : "public";

      // Buyer notification (persistente)
      await Notification.updateOne(
        { dedupeKey: `ticket_purchased:buyer:${savedTicket._id.toString()}` },
        {
          $setOnInsert: {
            userId: user._id,
            actorId: event.creatorId, // “chi lo ha venduto”
            type: "TICKET_PURCHASED",
            targetType: "ticket",
            targetId: savedTicket._id,
            message: "Ticket purchased successfully",
            isPersistent: true,
            data: {
              ticketId: savedTicket._id,
              eventId: event._id,
              eventTitle: event.title || null,
              scope,
              roomId: roomId || null,
              priceTokens,
              purchasedAt: savedTicket.purchasedAt || new Date(),
            },
            dedupeKey: `ticket_purchased:buyer:${savedTicket._id.toString()}`,
          },
        },
        { upsert: true }
      );

      // Creator notification (persistente)
      await Notification.updateOne(
        { dedupeKey: `ticket_purchased:creator:${savedTicket._id.toString()}` },
        {
          $setOnInsert: {
            userId: event.creatorId,
            actorId: user._id, // chi ha comprato
            type: "TICKET_PURCHASED",
            targetType: "event",
            targetId: event._id,
            message: "A user has purchased a ticket",
            isPersistent: true,
            data: {
              buyerId: user._id,
              eventId: event._id,
              ticketId: savedTicket._id,
              scope,
              roomId: roomId || null,
              priceTokens,
              scopeKey,
            },
            dedupeKey: `ticket_purchased:creator:${savedTicket._id.toString()}`,
          },
        },
        { upsert: true }
      );
    } catch (e) {
      console.error("NOTIFICATION_TICKET_PURCHASE_FAILED", e?.message || e);
      // NON bloccare l'acquisto
    }

    logTicketFlow("SUCCESS", {
      route: "POST /api/events/:id/ticket",
      eventId: String(event._id || ""),
      buyerId: String(user?._id || ""),
      creatorId: String(event.creatorId || ""),
      scope,
      roomId: roomId || null,
      mode: purchaseMode,
      ticketId: savedTicket?._id ? String(savedTicket._id) : null,
      priceTokens: Number(priceTokens || 0),
      newTokenBalance: Number(debit?.newTokenBalance || 0),
      creatorFundsMode: shouldHoldNativePrivateFunds ? "held" : "immediate_credit",
    });  

    return res.status(201).json({
      status: "success",
      message: "Ticket purchased successfully",
      data: {
        ticketId: savedTicket._id,
        eventId: event._id,
        userId: user._id,
        scope,
        roomId,
        priceTokens,
        newTokenBalance: debit?.newTokenBalance,
      },
    });
  } catch (err) {
    logTicketFlow("ERROR", {
      route: "POST /api/events/:id/ticket",
      eventId: String(req.params?.id || ""),
      buyerId: String(req.user?._id || ""),
      requestedScope: String(req.body?.scope || "public").trim().toLowerCase(),
      message: err?.message || "unknown_error",
      statusCode: err?.httpStatus || 500,
      code: err?.payload?.code || null,
      stack: err?.stack || null,
    });

    console.error("Ticket purchase error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during ticket purchase",
    });
  }
});

/**
 * @route   POST /api/events/:id/like
 * @desc    L'utente mette like a un evento
 * @access  Private
 */
router.post("/:id/like", auth, async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    const eventId = req.params.id;
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Invalid event ID",
      });
    }

    const event = await Event.findById(eventId).exec();
    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    const alreadyLiked = event.likedBy.some(
      (id) => id.toString() === user._id.toString()
    );

    if (alreadyLiked) {
      return res.status(200).json({
        status: "success",
        message: "You have already liked this event",
        data: {
          likesCount: event.likesCount || 0,
        },
      });
    }

    event.likedBy.push(user._id);
    event.likesCount = (event.likesCount || 0) + 1;

    await event.save();

    return res.status(201).json({
      status: "success",
      message: "Like added to the event",
      data: {
        likesCount: event.likesCount,
      },
    });
  } catch (err) {
    console.error("Event Like Error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during event like",
    });
  }
});

/**
 * @route   POST /api/events/:id/unlike
 * @desc    L'utente rimuove il like da un evento
 * @access  Private
 */
router.post("/:id/unlike", auth, async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    const eventId = req.params.id;
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Invalid event ID",
      });
    }

    const event = await Event.findById(eventId).exec();
    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    const before = event.likedBy.length;
    event.likedBy = event.likedBy.filter(
      (id) => id.toString() !== user._id.toString()
    );

    if (event.likedBy.length < before) {
      // Ha davvero tolto un like
      event.likesCount = Math.max((event.likesCount || 0) - 1, 0);
      await event.save();
    }

    return res.status(200).json({
      status: "success",
      message: "Like removed from the event",
      data: {
        likesCount: event.likesCount || 0,
      },
    });
  } catch (err) {
    console.error("Error unlike event:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during event unlike",
    });
  }
});

/**
 * @route   POST /api/events/:id/join
 * @desc    Ingresso evento + abilitazione funzioni Live
 * @access  Private (creator o utente con ticket valido)
 */
router.post("/:id/join", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ status: "error", message: "Unauthenticated user" });
    }

    const eventId = req.params.id;
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid event ID" });
    }

    const event = await Event.findById(eventId).exec();
    if (!event) {
      return res.status(404).json({ status: "error", message: "Event not found" });
    }

    // role
    const isCreator = String(event.creatorId) === String(user._id);
    const role = isCreator ? "host" : "viewer";

    // unlisted guard (host only)
    if (event.visibility === "unlisted" && !isCreator) {
      return res.status(403).json({
        status: "error",
        code: "EVENT_UNLISTED",
        message: "Event not available",
      });
    }

    const requestedScope =
      String(req.body?.scope || req.query?.scope || "public").trim().toLowerCase() === "private"
        ? "private"
        : "public";

    const access = await checkEventAccess({
      event,
      userId: user._id,
      requestedScope,
      accountType: getAccountTypeFromUser(user),
    });
    
    if (!access.canEnter) {
      // ✅ EVENT_NOT_LIVE = stato (ended/not live), non "deny"
      if (access.reason === "EVENT_NOT_LIVE") {
        return res.status(410).json({
          status: "error",
          code: "EVENT_NOT_LIVE",
          message: "Event is not live",
          data: { eventStatus: event.status },
        });
      }

      // tutti gli altri restano "deny"
      return res.status(403).json({
        status: "error",
        code: access.reason || "ACCESS_DENIED",
        message: "Access denied",
        data: { eventStatus: event.status },
      });
    }

    const effectiveScope = access.authorizedScope || "public";
    const authorizedRoomId = access.authorizedRoomId || null;

    // mute check
    const mutedUserIds = Array.isArray(event.mutedUserIds) ? event.mutedUserIds : [];
    const isMuted = mutedUserIds.some((id) => String(id) === String(user._id));

    // chat enabled flag: business truth must come from event root, not live runtime
    const chatEnabledForViewers =
      typeof event.chatEnabledForViewers === "boolean"
        ? event.chatEnabledForViewers
        : true;

    // carico dati aggiornati user dal DB per evitare valori stale su req.user
    const dbUser = await User.findById(user._id)
      .select("isVip tokenBalance accountType")
      .lean()
      .exec();

    const isAdmin = String(dbUser?.accountType || getAccountTypeFromUser(user) || "").toLowerCase() === "admin";
    const isVip = dbUser?.isVip === true;
    const tokenBalance = Number(dbUser?.tokenBalance || 0);

    const isPaidEvent = Number(event.ticketPriceTokens || 0) > 0 || effectiveScope === "private";

    let canChat = false;
    let canChatReason = "VIP_OR_TOKENS_REQUIRED";

    if (role === "host") {
      canChat = true;
      canChatReason = "HOST";
    } else if (isAdmin) {
      canChat = true;
      canChatReason = "ADMIN";
    } else if (!chatEnabledForViewers) {
      canChat = false;
      canChatReason = "CHAT_DISABLED";
    } else if (isMuted) {
      canChat = false;
      canChatReason = "MUTED";
    } else if (isPaidEvent) {
      canChat = true;
      canChatReason = "ALLOWED";
    } else if (isVip || tokenBalance > 0) {
      canChat = true;
      canChatReason = "ALLOWED";
    } else {
      canChat = false;
      canChatReason = "VIP_OR_TOKENS_REQUIRED";
    }

    const permissions = {
      canPublish: role === "host",
      canChat,
      canChatReason,
      canVote: false,
    };

    // roomId for player (public uses live.roomId or eventId; private uses authorizedRoomId)
    const roomId =
      effectiveScope === "private"
        ? (authorizedRoomId || event.privateSession?.roomId || null)
        : (event.live?.roomId || event._id.toString());

    return res.status(200).json({
      status: "success",
      message: "Entry to the event allowed",
      data: {
        eventId: event._id,
        userId: user._id,
        role,
        permissions,
        canEnter: true,
        eventStatus: event.status,

        access: {
          authorizedScope: effectiveScope,
          authorizedRoomId: effectiveScope === "private" ? (authorizedRoomId || null) : undefined,
        },

        isMuted,

        live: {
          roomId,
          startedAt: event.live?.startedAt || null,
          endedAt: event.live?.endedAt || null,
          allowEarlyJoinMinutes: event.live?.allowEarlyJoinMinutes ?? 10,
        },

        privateSession: effectiveScope === "private"
          ? {
              roomId: event.privateSession?.roomId || null,
              isEnabled: !!event.privateSession?.isEnabled,
              status: event.privateSession?.status || "idle",
              seats: event.privateSession?.seats || 0,
              countdownSeconds: event.privateSession?.countdownSeconds || 0,
              startedAt: event.privateSession?.startedAt || null,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("Error while joining event:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during event entry",
    });
  }
});

/**
 * @route   GET /api/events/:id/ticket
 * @desc    Verifica se l'utente loggato ha un ticket per questo evento
 * @access  Private
 */
router.get("/:id/ticket", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    const eventId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid event ID",
      });
    }

    const event = await Event.findById(eventId).exec();

    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    const isCreator = String(event.creatorId) === String(user._id);

    if (event.visibility === "unlisted" && !isCreator) {
      return res.status(403).json({
        status: "error",
        code: "EVENT_UNLISTED",
        message: "Event not available",
      });
    }

    const blocked = await isUserBlockedEitherSide(String(user._id), String(event.creatorId));
    if (blocked) {
      return res.status(403).json({
        status: "error",
        code: "EVENT_BLOCKED",
        message: "Event not available",
      });
    }

    const exists = await Ticket.findOne({
      eventId: event._id,
      userId: user._id,
      status: "active",
    }).select("_id scope roomId").lean();

    const hasTicket = !!exists;

    return res.status(200).json({
      status: "success",
      data: {
        eventId: event._id,
        hasTicket,
        status: event.status,
        ticketsSoldCount: event.ticketsSoldCount,
        maxSeats: event.maxSeats,
        ticket: exists || null,
      },
    });
  } catch (err) {
    console.error("Event ticket verification error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during ticket verification",
    });
  }
});

module.exports = router;
