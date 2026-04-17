// routes/liveRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const featureGuard = require("../middleware/featureGuard");
const Event = require("../models/event");
const LiveRoom = require("../models/LiveRoom");
const Ticket = require("../models/ticket");
const LivePresence = require("../models/LivePresence");
const { checkEventAccess } = require("../services/eventAccessService");
const TokenTransaction = require("../models/tokenTransaction");
const LiveMessage = require("../models/LiveMessage");
const { detectContentSafety } = require("../utils/contentSafety");
const { analyzeTextModeration } = require("../services/moderationService");
const Report = require("../models/Report");
const Notification = require("../models/notification");
const AdminAuditLog = require("../models/AdminAuditLog");
const User = require("../models/user");
const {
  ensureMeetingForRoom,
  ensureHostParticipantForRoom,
  issueViewerParticipantToken,
  markHostRealtimeState,
  startMeetingLivestream,
} = require("../services/realtimeKitService");

// helper: normalizza scope (public/private)
function getScopeFromReq(req) {
  const raw = (req.query?.scope ?? req.body?.scope ?? "public").toString().trim().toLowerCase();
  if (raw !== "public" && raw !== "private") return "public";
  return raw;
}

const PRESENCE_TTL_MS = 40 * 1000;
const PUBLIC_ROOM_HARD_CAP = 200;

function getPrivateSessionCounterForScope(event, scope) {
  if (scope !== "private") return null;
  return Number(event?.privateSessionCounter || 0);
}

function getRoomIdForScope(event, scope, authorizedRoomId = null) {
  if (scope === "private") {
    return authorizedRoomId || event?.privateSession?.roomId || null;
  }
  return event?.live?.roomId || String(event?._id || "");
}

function buildPresenceFilter({ eventId, scope, userId, privateSessionCounter }) {
  const filter = {
    eventId,
    scope,
    userId,
  };

  if (scope === "private") {
    filter.privateSessionCounter = Number(privateSessionCounter || 0);
  }

  return filter;
}

function buildRoomFilter({ eventId, scope, privateSessionCounter }) {
  const filter = {
    eventId,
    scope,
  };

  if (scope === "private") {
    filter.privateSessionCounter = Number(privateSessionCounter || 0);
  }

  return filter;
}

async function leaveAllUserPresencesForEvent({ eventId, userId }) {
  await LivePresence.updateMany(
    {
      eventId,
      userId,
      status: "active",
    },
    {
      $set: {
        status: "left",
        leftAt: new Date(),
      },
    }
  );
}

async function recountRoomViewers({ eventId, scope, creatorId, privateSessionCounter }) {
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS);

  const adminRows = await User.find({ accountType: "admin" })
    .select("_id")
    .lean()
    .exec();

  const excludedUserIds = [
    String(creatorId),
    ...adminRows.map((row) => String(row._id)),
  ];

  const countFilter = {
    eventId,
    scope,
    status: "active",
    lastSeenAt: { $gte: cutoff },
    userId: { $nin: excludedUserIds },
  };

  if (scope === "private") {
    countFilter.privateSessionCounter = Number(privateSessionCounter || 0);
  }

  const viewersNow = await LivePresence.countDocuments(countFilter);
  return { viewersNow, cutoff };
}

// Anti-spam minimale: 1 msg/sec per user per event
const CHAT_RATE_LIMIT_MS = 1000;
const lastChatMsgAt = new Map(); // key: `${eventId}:${userId}` -> timestamp ms

function canSendChat(eventId, userId) {
  const key = `${String(eventId)}:${String(userId)}`;
  const now = Date.now();
  const last = lastChatMsgAt.get(key) || 0;
  if (now - last < CHAT_RATE_LIMIT_MS) return { ok: false, retryAfterMs: CHAT_RATE_LIMIT_MS - (now - last) };
  lastChatMsgAt.set(key, now);
  return { ok: true, retryAfterMs: 0 };
}

function shouldEscalateToAI(text) {
  if (!text) return false;

  const t = text.toLowerCase().trim();

  // troppo corto → inutile
  if (t.length < 8) return false;

  // messaggi banali
  if (/^(ok|ciao|ahah|lol|yes|no|grazie|thanks)$/i.test(t)) return false;

  // contiene parole potenzialmente sensibili → escalation
  const suspicious = [
    "sex", "nude", "escort", "minor", "teen", "rape", "kill",
    "suicide", "violence", "blood", "drug", "cocaine",
    "hate", "bitch", "fuck", "slave", "abuse"
  ];

  if (suspicious.some(w => t.includes(w))) return true;

  // testi lunghi → escalation
  if (t.length > 120) return true;

  return false;
}

function inferAISuggestedSeverity(aiModeration) {
  const labels = Array.isArray(aiModeration?.labels) ? aiModeration.labels.map((x) => String(x).toLowerCase()) : [];
  const reason = String(aiModeration?.reason || "").toLowerCase();

  const gravissimoSignals = ["csam", "child", "minor", "underage", "pedo", "pedoph", "sexual_minor"];

  const hasGravissimoSignal =
    labels.some((l) => gravissimoSignals.some((k) => l.includes(k))) ||
    gravissimoSignals.some((k) => reason.includes(k));

  if (hasGravissimoSignal) return "gravissimo";
  if (aiModeration?.flagged) return "grave";
  return null;
}

function inferAICategory(aiModeration) {
  const labels = Array.isArray(aiModeration?.labels) ? aiModeration.labels.map((x) => String(x).toLowerCase()) : [];
  const reason = String(aiModeration?.reason || "").toLowerCase();

  if (
    labels.some((l) => l.includes("csam") || l.includes("minor") || l.includes("underage") || l.includes("child")) ||
    reason.includes("csam") ||
    reason.includes("minor") ||
    reason.includes("underage") ||
    reason.includes("child")
  ) {
    return "csam";
  }

  return labels[0] || "ai_flagged";
}

async function createOrUpdateAILiveReport({
  targetId,
  targetOwnerId,
  reason,
  severity,
  category,
  score,
  labels,
}) {
  const mappedReason = severity === "gravissimo" ? "ILLEGAL_CONTENT" : "INAPPROPRIATE_CONTENT";
  const mappedPriority = severity === "gravissimo" ? "P0" : "P1";
  const mappedPriorityScore = severity === "gravissimo" ? 0 : 1;

  const report = await Report.findOneAndUpdate(
    {
      source: "ai",
      targetType: "live_message",
      targetId: new mongoose.Types.ObjectId(String(targetId)),
      status: { $in: ["pending", "hidden"] },
    },
    {
      $set: {
        reporterId: null,
        source: "ai",
        targetType: "live_message",
        targetId: new mongoose.Types.ObjectId(String(targetId)),
        reason: mappedReason,
        note: reason || "ai_flagged",
        severity: mappedPriority,
        status: "pending",
        confirmedSeverity: null,
        confirmedCategory: null,
        targetOwnerId: targetOwnerId ? new mongoose.Types.ObjectId(String(targetOwnerId)) : null,
        priorityScore: mappedPriorityScore,
        aiReview: {
          score: Number(score || 0),
          labels: Array.isArray(labels) ? labels : [],
          suggestedSeverity: severity,
        },
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  try {
    await Notification.create({
      userId: null,
      actorId: null,
      type: "ADMIN_REPORT_PENDING",
      targetType: "report",
      targetId: report._id,
      message: `AI flagged live_message (${severity})`,
      data: {
        reportId: String(report._id),
        source: "ai",
        targetType: "live_message",
        targetId: String(targetId),
        suggestedSeverity: severity,
        category: category || null,
        score: Number(score || 0),
        labels: Array.isArray(labels) ? labels : [],
        reason: reason || "ai_flagged",
      },
      isPersistent: false,
      dedupeKey: `admin:report:${report._id}:pending`,
    });
  } catch (e) {
    if (e?.code !== 11000) {
      console.error("AI live admin notification error:", e);
    }
  }

  return report;
}

/**
 * @route POST /api/live/token
 * @desc Generate Cloudflare Realtime participant token for the authorized live room
 * @access Private
 */
router.post("/token", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    const eventId = String(req.body?.eventId || "").trim();
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Invalid event ID",
      });
    }

    const requestedScope = getScopeFromReq(req);

    const event = await Event.findById(eventId).exec();
    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    const isHost = String(user._id) === String(event.creatorId);
    const isAdmin = String(user.accountType || "").toLowerCase() === "admin";
    const eventStatus = String(event.status || "").trim().toLowerCase();
    const isEventLive = eventStatus === "live";

    // PRE-LIVE HOST ACCESS:
    // - host can get realtime token even when event is not live yet
    // - admin does NOT get this bypass
    // - viewers still require event live
    if (!isEventLive && !isHost) {
      return res.status(409).json({
        status: "error",
        code: "EVENT_NOT_LIVE",
        message: "Event is not live",
      });
    }

    let access;

    if (isHost && !isEventLive) {
      access = {
        canEnter: true,
        authorizedScope: requestedScope === "private" ? "private" : "public",
        authorizedRoomId:
          requestedScope === "private"
            ? (event?.privateSession?.roomId || null)
            : (event?.live?.roomId || String(event?._id || "")),
      };
    } else {
      access = await checkEventAccess({
        event,
        userId: user._id,
        requestedScope,
        accountType: user.accountType,
      });
    }

    if (!access.canEnter) {
      return res.status(403).json({
        status: "error",
        code: access.reason || "ACCESS_DENIED",
        message: "Access denied",
      });
    }

    const effectiveScope = access.authorizedScope;
    if (!effectiveScope || (effectiveScope !== "public" && effectiveScope !== "private")) {
      return res.status(403).json({
        status: "error",
        code: "ACCESS_DENIED",
        message: "Access denied",
      });
    }

    const role = isHost ? "host" : "viewer";

    const ensuredMeeting = await ensureMeetingForRoom({
      event,
      scope: effectiveScope,
    });

    let participant;

    if (isHost) {
      participant = await ensureHostParticipantForRoom({
        event,
        scope: effectiveScope,
        user,
        meetingId: ensuredMeeting.meetingId,
      });
    } else {
      participant = await issueViewerParticipantToken({
        meetingId: ensuredMeeting.meetingId,
        user,
      });
    }

    return res.status(200).json({
      status: "success",
      data: {
        eventId: String(event._id),
        requestedScope,
        authorizedScope: effectiveScope,
        scope: effectiveScope,
        roomId:
          effectiveScope === "private"
            ? (event?.privateSession?.roomId || access.authorizedRoomId || null)
            : (event?.live?.roomId || String(event._id)),
        provider: "cloudflare",
        meetingId: ensuredMeeting.meetingId,
        authToken: participant.token,
        participantId: participant.participantId,
        participantPreset: participant.presetName,
        role,
        isHost,
        isAdmin,
        viewerCountMode: "nestx_presence",
      },
    });
  } catch (err) {
    console.error("Error during live token generation:", err);

    if (err?.code === "MISSING_ENV") {
      return res.status(500).json({
        status: "error",
        code: "REALTIME_CONFIG_MISSING",
        message: err.message,
      });
    }

    if (err?.code === "CF_API_ERROR") {
      return res.status(502).json({
        status: "error",
        code: "REALTIME_PROVIDER_ERROR",
        message: "Cloudflare Realtime error",
      });
    }

    return res.status(500).json({
      status: "error",
      message: "Internal error while generating live token",
    });
  }
});

/**
 * @route POST /api/live/:eventId/start-broadcast
 * @desc Start real provider broadcast for the host meeting
 * @access Private
 */
router.post("/:eventId/start-broadcast", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    const eventId = String(req.params.eventId || "").trim();
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Invalid event ID",
      });
    }

    const requestedScope = getScopeFromReq(req);

    const event = await Event.findById(eventId).exec();
    if (!event) {
      return res.status(404).json({
        status: "error",
        message: "Event not found",
      });
    }

    const isHost = String(user._id) === String(event.creatorId);
    const isAdmin = String(user.accountType || "").toLowerCase() === "admin";

    if (!isHost && !isAdmin) {
      return res.status(403).json({
        status: "error",
        code: "ACCESS_DENIED",
        message: "Access denied",
      });
    }

    const effectiveScope =
      requestedScope === "private" ? "private" : "public";

    const ensuredMeeting = await ensureMeetingForRoom({
      event,
      scope: effectiveScope,
    });

    const livestream = await startMeetingLivestream({
      meetingId: ensuredMeeting.meetingId,
    });

    await markHostRealtimeState({
      eventId: event._id,
      scope: effectiveScope,
      state: "broadcasting",
      broadcastStarted: true,
    });

    return res.status(200).json({
      status: "success",
      data: {
        eventId: String(event._id),
        scope: effectiveScope,
        provider: "cloudflare",
        meetingId: ensuredMeeting.meetingId,
        livestreamId: livestream?.livestreamId || null,
        livestreamSessionId: livestream?.sessionId || null,
        playbackUrl: livestream?.playbackUrl || null,
        alreadyActive: Boolean(livestream?.alreadyActive),
      },
    });
  } catch (err) {
    console.error("Error during start-broadcast:", err);

    if (err?.code === "MISSING_ENV") {
      return res.status(500).json({
        status: "error",
        code: "REALTIME_CONFIG_MISSING",
        message: err.message,
      });
    }

    if (err?.code === "CF_API_ERROR") {
      return res.status(502).json({
        status: "error",
        code: "REALTIME_PROVIDER_ERROR",
        message: "Cloudflare Realtime error",
      });
    }

    return res.status(500).json({
      status: "error",
      message: "Internal error while starting provider broadcast",
    });
  }
});

/**
 * @route POST /api/live/:eventId/host-realtime-state
 * @desc Sync host realtime state (setup/joined/broadcasting/ended)
 * @access Private
 */
router.post("/:eventId/host-realtime-state", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ status: "error", message: "Unauthenticated user" });
    }

    const eventId = String(req.params.eventId || "").trim();
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid event ID" });
    }

    const scope = getScopeFromReq(req);
    const nextState = String(req.body?.state || "").trim().toLowerCase();

    if (!["idle", "setup", "joined", "broadcasting", "ended"].includes(nextState)) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_HOST_REALTIME_STATE",
        message: "Invalid host realtime state",
      });
    }

    const event = await Event.findById(eventId)
      .select("_id creatorId")
      .lean()
      .exec();

    if (!event) {
      return res.status(404).json({ status: "error", message: "Event not found" });
    }

    const isHost = String(user._id) === String(event.creatorId);
    const isAdmin = String(user.accountType || "").toLowerCase() === "admin";

    if (!isHost && !isAdmin) {
      return res.status(403).json({
        status: "error",
        code: "ACCESS_DENIED",
        message: "Access denied",
      });
    }

    await markHostRealtimeState({
      eventId,
      scope,
      state: nextState,
      broadcastStarted: nextState === "broadcasting",
    });

    return res.status(200).json({
      status: "success",
      data: {
        eventId,
        scope,
        state: nextState,
      },
    });
  } catch (err) {
    console.error("Error during host-realtime-state:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while syncing host realtime state",
    });
  }
});

/**
 * @route   POST /api/live/:eventId/join-room
 * @desc    Registra ingresso utente in live room (contatore spettatori)
 * @access  Private
 */
router.post("/:eventId/join-room", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const eventId = req.params.eventId;
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid event ID" });
    }

    const event = await Event.findById(eventId).exec();
    console.log("JOIN_ROOM_DEBUG", {
      eventId: String(event?._id || ""),
      status: event?.status,
      contentScope: event?.contentScope,
      accessScope: event?.accessScope,

      // 🔴 QUESTO CI INTERESSA
      event_chatEnabledForViewers: event?.chatEnabledForViewers,
      live_chatEnabledForViewers: event?.live?.chatEnabledForViewers,

      // DEBUG EXTRA
      interactionMode: event?.interactionMode,
      live: event?.live,

      // USER
      userId: String(req.user?._id || ""),
    });
    if (!event) return res.status(404).json({ status: "error", message: "Event not found" });

    const isHost = String(user._id) === String(event.creatorId);
    const isAdmin = String(user.accountType || "").toLowerCase() === "admin";

    const requestedScope = getScopeFromReq(req); // "public" | "private"

    const access = await checkEventAccess({
      event,
      userId: user._id,
      requestedScope,
      accountType: user.accountType,
    });

    if (!access.canEnter) {
      return res.status(403).json({
        status: "error",
        code: access.reason || "ACCESS_DENIED",
        message: "Access denied",
      });
    }

    const effectiveScope = access.authorizedScope;
    const authorizedRoomId = access.authorizedRoomId || null;

    if (!effectiveScope) {
      return res.status(403).json({
        status: "error",
        code: "ACCESS_DENIED",
        message: "Access denied",
      });
    }

    const privateSessionCounter = getPrivateSessionCounterForScope(event, effectiveScope);
    const roomId = getRoomIdForScope(event, effectiveScope, authorizedRoomId);

    if (!roomId) {
      return res.status(400).json({ status: "error", message: "Invalid room configuration" });
    }

    const roomFilter = buildRoomFilter({
      eventId: event._id,
      scope: effectiveScope,
      privateSessionCounter,
    });

    let liveRoom = await LiveRoom.findOne(roomFilter).exec();
    if (!liveRoom) {
      liveRoom = await LiveRoom.create({
        eventId: event._id,
        scope: effectiveScope,
        privateSessionCounter,
        roomId,
        hostId: event.creatorId,
        status: "active",
        currentViewersCount: 0,
        peakViewersCount: 0,
      });
    }

    // Host/Admin: no presence, no viewer count
    if (isHost || isAdmin) {
      return res.status(200).json({
        status: "success",
        message: isHost
          ? "Host joined (not counted as viewer)"
          : "Admin joined (not counted as viewer)",
        data: {
          eventId: event._id,
          requestedScope,
          authorizedScope: effectiveScope,
          scope: effectiveScope,
          roomId: liveRoom.roomId,
          alreadyJoined: true,
          currentViewersCount: Number(liveRoom.currentViewersCount || 0),
          peakViewersCount: Number(liveRoom.peakViewersCount || 0),
          role: isHost ? "host" : "admin",
          isHost,
          isAdmin,
        },
      });
    }

    // HARD CAP solo su room public, host escluso
    if (effectiveScope === "public") {
      const alreadyActiveInPublic = await LivePresence.findOne({
        ...buildPresenceFilter({
          eventId: event._id,
          scope: "public",
          userId: user._id,
          privateSessionCounter: null,
        }),
        status: "active",
      })
        .select("_id")
        .lean()
        .exec();

      if (!alreadyActiveInPublic) {
        const { viewersNow: publicViewersNow } = await recountRoomViewers({
          eventId: event._id,
          scope: "public",
          creatorId: event.creatorId,
          privateSessionCounter: null,
        });

        if (Number(publicViewersNow || 0) >= PUBLIC_ROOM_HARD_CAP) {
          return res.status(403).json({
            status: "error",
            code: "ROOM_FULL",
            message: "Room is full",
          });
        }
      }
    }

    // prima di entrare nella nuova stanza, esci da qualsiasi altra presence attiva nello stesso evento
    await leaveAllUserPresencesForEvent({
      eventId: event._id,
      userId: user._id,
    });

    // Presence upsert (idempotent join / rejoin)
    const presenceFilter = buildPresenceFilter({
      eventId: event._id,
      scope: effectiveScope,
      userId: user._id,
      privateSessionCounter,
    });

    const existingActive = await LivePresence.findOne({
      ...presenceFilter,
      status: "active",
    })
      .select("_id")
      .lean()
      .exec();

    const isFirstJoin = !existingActive;
    const now = new Date();

    await LivePresence.updateOne(
      presenceFilter,
      {
        $setOnInsert: {
          eventId: event._id,
          scope: effectiveScope,
          userId: user._id,
          privateSessionCounter,
          joinedAt: now,
        },
        $set: {
          roomId,
          status: "active",
          leftAt: null,
          lastSeenAt: now,
        },
      },
      { upsert: true }
    );

    // Anti-ghost viewersNow (TTL) + exclude host (safety)
    const { viewersNow, cutoff } = await recountRoomViewers({
      eventId: event._id,
      scope: effectiveScope,
      creatorId: event.creatorId,
      privateSessionCounter,
    });

    // Sync LiveRoom counters from truth (no drift)
    liveRoom.currentViewersCount = Number(viewersNow || 0);
    if (Number(viewersNow || 0) > Number(liveRoom.peakViewersCount || 0)) {
      liveRoom.peakViewersCount = Number(viewersNow || 0);
    }
    await liveRoom.save();

    // Optional: keep event.viewerCount aligned for UI
    try {
      await Event.updateOne(
        { _id: event._id },
        { $set: { viewerCount: Number(liveRoom.currentViewersCount || 0) } }
      );
    } catch {}

    return res.status(200).json({
      status: "success",
      message: "Recorded live room entry",
      data: {
        eventId: event._id,
        requestedScope,
        authorizedScope: effectiveScope,
        scope: effectiveScope,
        roomId: liveRoom.roomId,
        userId: user._id,
        alreadyJoined: !isFirstJoin,
        currentViewersCount: Number(liveRoom.currentViewersCount || 0),
        peakViewersCount: Number(liveRoom.peakViewersCount || 0),
        privateSessionCounter,
        viewersTtlMs: PRESENCE_TTL_MS,
        viewersCutoff: cutoff,
        role: isHost ? "host" : "viewer",
        isHost: false
      },
    });
  } catch (err) {
    console.error("Error during join-room:", err);
    return res.status(500).json({ status: "error", message: "Internal error while entering the live room" });
  }
});

/**
 * @route   POST /api/live/:eventId/leave-room
 * @desc    Registra l'uscita di un utente dalla live room (decrementa contatore)
 * @access  Private
 */
router.post("/:eventId/leave-room", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const eventId = req.params.eventId;
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid event ID" });
    }

    const event = await Event.findById(eventId).exec();
    if (!event) return res.status(404).json({ status: "error", message: "Event not found" });

    const isHost = String(user._id) === String(event.creatorId);
    const isAdmin = String(user.accountType || "").toLowerCase() === "admin";

    if (isHost || isAdmin) {
      return res.status(200).json({
        status: "success",
        message: isHost
          ? "Host left (not counted as viewer)"
          : "Admin left (not counted as viewer)",
        data: { isHost, isAdmin },
      });
    }

    // Find active presence (truth)
    const activePresence = await LivePresence.findOne({
      eventId: event._id,
      userId: user._id,
      status: "active",
    })
      .select("scope roomId privateSessionCounter")
      .lean()
      .exec();

    if (!activePresence) {
      return res.status(200).json({
        status: "success",
        message: "Exit already recorded (user was not present)",
        data: { alreadyLeft: true },
      });
    }

    const effectiveScope = activePresence.scope || "public";
    const privateSessionCounter =
      effectiveScope === "private"
        ? Number(activePresence.privateSessionCounter || 0)
        : null;

    const roomId =
      activePresence.roomId ||
      getRoomIdForScope(event, effectiveScope, null);

    await LivePresence.updateOne(
      buildPresenceFilter({
        eventId: event._id,
        scope: effectiveScope,
        userId: user._id,
        privateSessionCounter,
      }),
      { $set: { status: "left", leftAt: new Date(), roomId } }
    );

    const roomFilter = buildRoomFilter({
      eventId: event._id,
      scope: effectiveScope,
      privateSessionCounter,
    });

    let liveRoom = await LiveRoom.findOne(roomFilter).exec();
    if (!liveRoom) {
      liveRoom = await LiveRoom.create({
        eventId: event._id,
        scope: effectiveScope,
        privateSessionCounter,
        roomId,
        hostId: event.creatorId,
        status: "active",
        currentViewersCount: 0,
        peakViewersCount: 0,
      });
    }

    const { viewersNow, cutoff } = await recountRoomViewers({
      eventId: event._id,
      scope: effectiveScope,
      creatorId: event.creatorId,
      privateSessionCounter,
    });

    liveRoom.currentViewersCount = Number(viewersNow || 0);
    await liveRoom.save();

    try {
      await Event.updateOne({ _id: event._id }, { $set: { viewerCount: Number(viewersNow || 0) } });
    } catch {}

    return res.status(200).json({
      status: "success",
      message: "Exit from live room recorded",
      data: {
        eventId: event._id,
        scope: effectiveScope,
        roomId,
        currentViewersCount: Number(liveRoom.currentViewersCount || 0),
        privateSessionCounter,
        viewersTtlMs: PRESENCE_TTL_MS,
        viewersCutoff: cutoff,
      },
    });
  } catch (err) {
    console.error("Error during leave-room:", err);
    return res.status(500).json({ status: "error", message: "Internal error while leaving the live room" });
  }
});

/**
 * @route   GET /api/live/:eventId/status
 * @desc    Info live room (contatori, stato)
 * @access  Private (per ora)
 */
router.get("/:eventId/status", auth, featureGuard("live"), async (req, res) => {
  try {
    const requestedScope = getScopeFromReq(req);
    const eventId = req.params.eventId;

    if (!eventId || eventId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid event ID" });
    }

    const event = await Event.findById(eventId)
      .select("_id status live creatorId privateSession privateSessionCounter accessScope ticketPriceTokens")
      .lean()
      .exec();

    if (!event) {
      return res.status(404).json({ status: "error", message: "Event not found" });
    }

    const access = await checkEventAccess({
      event,
      userId: req.user._id,
      requestedScope,
      accountType: req.user.accountType,
    });

    if (!access.canEnter) {
      return res.status(403).json({
        status: "error",
        code: access.reason || "ACCESS_DENIED",
        message: "Access denied",
      });
    }

    const effectiveScope = access.authorizedScope;
    const privateSessionCounter = getPrivateSessionCounterForScope(event, effectiveScope);

    if (!effectiveScope) {
      return res.status(403).json({
        status: "error",
        code: "ACCESS_DENIED",
        message: "Access denied",
      });
    }

    const { viewersNow, cutoff } = await recountRoomViewers({
      eventId: event._id,
      scope: effectiveScope,
      creatorId: event.creatorId,
      privateSessionCounter,
    });

    const liveRoomDoc = await LiveRoom.findOne(
      buildRoomFilter({
        eventId: event._id,
        scope: effectiveScope,
        privateSessionCounter,
      })
    ).lean().exec();

    // Optional: align LiveRoom counters to truth (no drift)
    try {
      if (liveRoomDoc) {
        const current = Number(liveRoomDoc.currentViewersCount || 0);
        const truth = Number(viewersNow || 0);

        const nextPeak = Math.max(Number(liveRoomDoc.peakViewersCount || 0), truth);

        if (current !== truth || nextPeak !== Number(liveRoomDoc.peakViewersCount || 0)) {
          await LiveRoom.updateOne(
            { _id: liveRoomDoc._id },
            { $set: { currentViewersCount: truth, peakViewersCount: nextPeak } }
          );
        }
      }
    } catch {}

    const ps = event.privateSession || null;
    
    return res.status(200).json({
      status: "success",
      message: "Live room status retrieved successfully",
      data: {
        eventStatus: event.status,
        privateStatus:
          ps && ps.isEnabled === true
            ? String(ps.status || "idle")
            : "idle",

        authorizedScope: effectiveScope,
        scope: effectiveScope,

        viewerCount: Number(viewersNow || 0),
        viewersNow: Number(viewersNow || 0),
        viewersCutoff: cutoff,
        privateSessionCounter,
        viewersTtlMs: PRESENCE_TTL_MS,

        live: event.live || null,

        privateSession:
          ps && ps.isEnabled === true
            ? {
                status: ps.status,
                roomId: ps.roomId,
                seats: ps.seats,
                ticketPriceTokens: ps.ticketPriceTokens,
                countdownSeconds: ps.countdownSeconds,
                startedAt: ps.startedAt,
                createdAt: ps.createdAt,
              }
            : null,
      },

      liveRoom: liveRoomDoc
        ? {
            roomId: liveRoomDoc.roomId,
            scope: liveRoomDoc.scope,
            status: liveRoomDoc.status,
            currentViewersCount: Number(liveRoomDoc.currentViewersCount || 0),
            peakViewersCount: Number(liveRoomDoc.peakViewersCount || 0),
            hostId: liveRoomDoc.hostId,
          }
        : null,
    });
  } catch (err) {
    console.error("Error during status:", err);
    return res.status(500).json({ status: "error", message: "Internal error while retrieving the live room" });
  }
});

/**
 * @route   POST /api/live/:eventId/ping
 * @desc    Heartbeat presence (anti-ghost). Does NOT change counters.
 * @access  Private
 */
router.post("/:eventId/ping", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const eventId = req.params.eventId;
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid event ID" });
    }

    const event = await Event.findById(eventId)
      .select("_id creatorId status accessScope live privateSession privateSessionCounter ticketPriceTokens")
      .lean()
      .exec();
    if (!event) return res.status(404).json({ status: "error", message: "Event not found" });

    const isHost = String(event.creatorId) === String(user._id);
    const isAdmin = String(user.accountType || "").toLowerCase() === "admin";

    const requestedScope = getScopeFromReq(req);

    const access = await checkEventAccess({
      event,
      userId: user._id,
      requestedScope,
      accountType: user.accountType,
    });

    if (!access.canEnter) {
      return res.status(403).json({
        status: "error",
        code: access.reason || "ACCESS_DENIED",
        message: "Access denied",
      });
    }

    const effectiveScope = access.authorizedScope || requestedScope;
    const authorizedRoomId = access.authorizedRoomId || null;
    const privateSessionCounter = getPrivateSessionCounterForScope(event, effectiveScope);
    const roomId = getRoomIdForScope(event, effectiveScope, authorizedRoomId);

    const now = new Date();

    const presenceFilter = buildPresenceFilter({
      eventId: event._id,
      scope: effectiveScope,
      userId: user._id,
      privateSessionCounter,
    });

    // host/admin: ping consentito senza presence
    if (!isHost && !isAdmin) {
      const existingActivePresence = await LivePresence.findOne({
        ...presenceFilter,
        status: "active",
      })
        .select("_id")
        .lean()
        .exec();

      if (!existingActivePresence) {
        return res.status(403).json({
          status: "error",
          code: "ROOM_PRESENCE_REQUIRED",
          message: "Join room before ping",
        });
      }
    }

    const updated = (isHost || isAdmin)
      ? { matchedCount: 0, modifiedCount: 0 }
      : await LivePresence.updateOne(
          {
            ...presenceFilter,
            status: "active",
          },
          {
            $set: {
              roomId,
              lastSeenAt: now,
            },
          }
        );

    await LiveRoom.updateOne(
      buildRoomFilter({
        eventId: event._id,
        scope: effectiveScope,
        privateSessionCounter,
      }),
      {
        $setOnInsert: {
          eventId: event._id,
          scope: effectiveScope,
          privateSessionCounter,
          roomId,
          hostId: event.creatorId,
          status: "active",
          currentViewersCount: 0,
          peakViewersCount: 0,
        },
      },
      { upsert: true }
    );

    const { viewersNow } = await recountRoomViewers({
      eventId: event._id,
      scope: effectiveScope,
      creatorId: event.creatorId,
      privateSessionCounter,
    });

    await LiveRoom.updateOne(
      buildRoomFilter({
        eventId: event._id,
        scope: effectiveScope,
        privateSessionCounter,
      }),
      {
        $set: { currentViewersCount: Number(viewersNow || 0) },
        $max: { peakViewersCount: Number(viewersNow || 0) },
      }
    );

    // response
    return res.status(200).json({
      status: "success",
      data: {
        ok: true,
        effectiveScope,
        isHost,
        isAdmin,
        userId: user._id,
        matched: Number(updated?.matchedCount || 0),
        modified: Number(updated?.modifiedCount || 0),
        privateSessionCounter,
        currentViewersCount: Number(viewersNow || 0),
        viewersTtlMs: PRESENCE_TTL_MS,
      },
    });
  } catch (err) {
    console.error("Error during ping:", err);
    return res.status(500).json({ status: "error", message: "Internal error while pinging presence" });
  }
});

/**
 * @route   GET /api/live/:eventId/messages?scope=public&limit=80
 * @desc    Fetch chat messages (public/private)
 * @access  Private
 */
router.get("/:eventId/messages", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const eventId = req.params.eventId;
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid event ID" });
    }

    const requestedScope = getScopeFromReq(req); // "public" | "private"

    let limit = Number(req.query.limit || 80);
    if (!Number.isFinite(limit) || limit <= 0) limit = 80;
    if (limit > 200) limit = 200;

    const event = await Event.findById(eventId)
      .select("_id status creatorId ticketPriceTokens privateSession privateSessionCounter accessScope live")
      .lean()
      .exec();
      
    if (!event) return res.status(404).json({ status: "error", message: "Event not found" });

    // evento non live -> coerente con access service (ma risposte più chiare)
    if (String(event.status || "") !== "live") {
      const st = String(event.status || "");
      const code = st === "finished" || st === "cancelled" ? "EVENT_ENDED" : "EVENT_NOT_LIVE";
      const http = st === "finished" || st === "cancelled" ? 410 : 403;
      return res.status(http).json({ status: "error", code, message: "Chat not available" });
    }

    const access = await checkEventAccess({
      event,
      userId: user._id,
      requestedScope,
      accountType: user.accountType,
    });

    if (!access.canEnter) {
      return res.status(403).json({
        status: "error",
        code: access.reason || "ACCESS_DENIED",
        message: "Access denied",
      });
    }

    const effectiveScope = access.authorizedScope || requestedScope;
    const privateSessionCounter = getPrivateSessionCounterForScope(event, effectiveScope);

    // prendiamo gli ultimi N (desc) e li invertiamo (asc)
    const query =
      effectiveScope === "private"
        ? {
            eventId: event._id,
            scope: "private",
            privateSessionCounter: Number(privateSessionCounter || 0),
            "moderation.status": "visible",
          }
        : {
            eventId: event._id,
            scope: "public",
            "moderation.status": "visible",
          };

    const rows = await LiveMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("_id eventId scope userId displayName text createdAt")
      .lean()
      .exec();

    rows.reverse();

    return res.status(200).json({
      status: "success",
      data: rows,
    });
  } catch (err) {
    console.error("Error during GET messages:", err);
    return res.status(500).json({ status: "error", message: "Internal error while fetching messages" });
  }
});

/**
 * @route   POST /api/live/:eventId/messages
 * @desc    Post chat message (public/private)
 * @access  Private
 */
router.post("/:eventId/messages", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const eventId = req.params.eventId;
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid event ID" });
    }

    const requestedScope = getScopeFromReq(req); // "public" | "private"
    const textRaw = (req.body?.text ?? "").toString();
    const text = textRaw.trim();

    if (!text) {
      return res.status(400).json({ status: "error", code: "EMPTY_TEXT", message: "Text is required" });
    }
    if (text.length > 500) {
      return res.status(400).json({ status: "error", code: "TEXT_TOO_LONG", message: "Text too long" });
    }

    const safetyCheck = detectContentSafety(text, "public");
    if (safetyCheck.blocked) {
      return res.status(400).json({
        status: "error",
        code: safetyCheck.code,
        message: "Links, contacts, and external invitations are not allowed in live chat.",
      });
    }

    const event = await Event.findById(eventId)
      .select("_id status creatorId ticketPriceTokens privateSession privateSessionCounter accessScope live")
      .exec();

    if (!event) return res.status(404).json({ status: "error", message: "Event not found" });

    // evento non live
    if (String(event.status || "") !== "live") {
      const st = String(event.status || "");
      const code = st === "finished" || st === "cancelled" ? "EVENT_ENDED" : "EVENT_NOT_LIVE";
      const http = st === "finished" || st === "cancelled" ? 410 : 403;
      return res.status(http).json({ status: "error", code, message: "Chat not available" });
    }

    // rate limit
    const rl = canSendChat(event._id, user._id);
    if (!rl.ok) {
      return res.status(429).json({
        status: "error",
        code: "RATE_LIMIT",
        message: "Too many messages",
        retryAfterMs: rl.retryAfterMs,
      });
    }

    const access = await checkEventAccess({
      event,
      userId: user._id,
      requestedScope,
      accountType: user.accountType,
    });

    if (!access.canEnter) {
      return res.status(403).json({
        status: "error",
        code: access.reason || "ACCESS_DENIED",
        message: "Access denied",
      });
    }

    const effectiveScope = access.authorizedScope || requestedScope;
    const privateSessionCounter = getPrivateSessionCounterForScope(event, effectiveScope);

    const activePresence = await LivePresence.findOne({
      ...buildPresenceFilter({
        eventId: event._id,
        scope: effectiveScope,
        userId: user._id,
        privateSessionCounter,
      }),
      status: "active",
    })
      .select("_id")
      .lean()
      .exec();

    const isHost = String(user._id) === String(event.creatorId);
    const isAdmin = String(user.accountType || "").toLowerCase() === "admin";

    if (!activePresence && !isHost && !isAdmin) {
      return res.status(403).json({
        status: "error",
        code: "ROOM_PRESENCE_REQUIRED",
        message: "Join room before sending messages",
      });
    }

    const dbUser = await User.findById(user._id)
      .select("displayName isVip tokenBalance accountType")
      .lean()
      .exec();

    if (!dbUser) {
      return res.status(401).json({
        status: "error",
        message: "User not found",
      });
    }

    // Gate finale chat:
    // - host sempre ok
    // - admin sempre ok
    // - paid: già gestito da checkEventAccess
    // - free public: solo VIP o utente con tokenBalance > 0
    const isPaidEvent = Number(event.ticketPriceTokens || 0) > 0;
    const isFreePublicViewerCase = !isHost && !isAdmin && effectiveScope === "public" && !isPaidEvent;

    if (isFreePublicViewerCase) {
      const isVip = dbUser.isVip === true;
      const tokenBalance = Number(dbUser.tokenBalance || 0);

      if (!isVip && tokenBalance <= 0) {
        return res.status(403).json({
          status: "error",
          code: "CHAT_NOT_ALLOWED",
          message: "Chat is reserved to VIP users or users with tokens",
        });
      }
    }

    // snapshot displayName
    const displayName = String(dbUser.displayName || user.displayName || "").trim() || "User";

    let aiModeration = {
      flagged: false,
      score: 0,
      labels: [],
      reason: null,
      provider: "none",
      model: null,
    };

    if (shouldEscalateToAI(text)) {
      aiModeration = await analyzeTextModeration(text, {
        source: "live_message",
        visibility: effectiveScope,
      });
    }

    const aiSuggestedSeverity = inferAISuggestedSeverity(aiModeration);
    const aiCategory = inferAICategory(aiModeration);

    const doc = await LiveMessage.create({
      eventId: event._id,
      scope: effectiveScope,
      privateSessionCounter:
        effectiveScope === "private"
          ? Number(privateSessionCounter || 0)
          : null,
      userId: user._id,
      displayName,
      text,
      moderation: {
        status: aiModeration.flagged ? "under_review" : "visible",
        hiddenBy: aiModeration.flagged ? "ai" : null,
        hiddenReason: aiModeration.flagged ? (aiModeration.reason || "ai_flagged") : null,
        hiddenSeverity: aiModeration.flagged ? aiSuggestedSeverity : null,
        hiddenCategory: aiModeration.flagged ? aiCategory : null,
        hiddenAt: aiModeration.flagged ? new Date() : null,
        hiddenByAdminId: null,
        ai: {
          flagged: aiModeration.flagged,
          score: aiModeration.score,
          labels: aiModeration.labels,
          reason: aiModeration.reason,
          provider: aiModeration.provider,
          model: aiModeration.model,
          reviewedAt: new Date(),
        },
      },
      createdAt: new Date(),
    });

    if (aiModeration.flagged && aiSuggestedSeverity === "gravissimo") {
      await createOrUpdateAILiveReport({
        targetId: doc._id,
        targetOwnerId: user._id,
        reason: aiModeration.reason || "ai_flagged",
        severity: aiSuggestedSeverity,
        category: aiCategory,
        score: aiModeration.score,
        labels: aiModeration.labels,
      });

      try {
        await AdminAuditLog.create({
          adminId: null,
          actionType: "AI_HIDE_LIVE_MESSAGE",
          targetType: "live_message",
          targetId: String(doc._id),
          meta: {
            severity: aiSuggestedSeverity,
            category: aiCategory,
            reason: aiModeration.reason || "ai_flagged",
            score: aiModeration.score,
            labels: aiModeration.labels,
          },
        });
      } catch (e) {
        console.warn("AI_HIDE_LIVE_MESSAGE audit skipped:", e?.message || e);
      }
    }

    return res.status(201).json({
      status: "success",
      data: {
        _id: doc._id,
        eventId: doc.eventId,
        scope: doc.scope,
        userId: doc.userId,
        displayName: doc.displayName,
        text: doc.text,
        createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    console.error("Error during POST message:", err);
    return res.status(500).json({ status: "error", message: "Internal error while posting message" });
  }
});

module.exports = router;
