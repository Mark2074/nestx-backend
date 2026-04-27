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
  markHostRealtimeState,
  markHostHeartbeat,
  resetRuntimeForScope,
} = require("../services/liveRuntimeService");

// helper: normalizza scope (public/private)
function getScopeFromReq(req) {
  const raw = (req.query?.scope ?? req.body?.scope ?? "public").toString().trim().toLowerCase();
  if (raw !== "public" && raw !== "private") return "public";
  return raw;
}

const PRESENCE_TTL_MS = 40 * 1000;
const PUBLIC_ROOM_HARD_CAP = 200;

const HOST_STALE_MS = 20 * 1000;
const HOST_DISCONNECT_GRACE_MS = 2 * 60 * 1000;
const HOST_MEDIA_STALE_MS = 20 * 1000;

const OME_RTMP_URL = String(process.env.OME_RTMP_URL || "").trim();
const OME_PLAYBACK_BASE_URL = String(process.env.OME_PLAYBACK_BASE_URL || "").trim().replace(/\/+$/, "");
const OME_MANIFEST_NAME = String(process.env.OME_MANIFEST_NAME || "master.m3u8").trim() || "master.m3u8";

function getOmeStreamKey(event) {
  return String(event?._id || "").trim();
}

function buildOmePlaybackUrl(event) {
  const streamKey = getOmeStreamKey(event);
  if (!OME_PLAYBACK_BASE_URL || !streamKey) return null;
  return `${OME_PLAYBACK_BASE_URL}/${streamKey}/${OME_MANIFEST_NAME}`;
}

function getCanonicalPlaybackUrl(event) {
  return buildOmePlaybackUrl(event);
}

function sanitizePlaybackUrl(url, event) {
  const raw = String(url || "").trim();
  const fallback = buildOmePlaybackUrl(event);

  if (!raw) return fallback;

  if (/^http:\/\//i.test(raw) && /^https:\/\//i.test(String(OME_PLAYBACK_BASE_URL || ""))) {
    return fallback;
  }

  return raw;
}

async function fetchTextWithTimeout(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
      },
    });

    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveHlsUrl(baseUrl, childUrl) {
  const raw = String(childUrl || "").trim();
  if (!raw) return null;

  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractFirstVariantUrl(masterText, masterUrl) {
  const lines = String(masterText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      const next = lines[i + 1];
      if (next && !next.startsWith("#")) {
        return resolveHlsUrl(masterUrl, next);
      }
    }
  }

  return null;
}

function extractHlsSignature(mediaText) {
  const lines = String(mediaText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const mediaSequence =
    lines.find((line) => line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) || "";

  const segments = lines.filter((line) => !line.startsWith("#"));
  const lastSegment = segments[segments.length - 1] || "";

  if (!mediaSequence && !lastSegment) return null;

  return `${mediaSequence}|${lastSegment}`;
}

async function probePlaybackUrl(playbackUrl) {
  if (!playbackUrl) {
    return {
      ok: false,
      signature: null,
    };
  }

  const masterText = await fetchTextWithTimeout(playbackUrl, 3000);
  if (!masterText || !masterText.includes("#EXTM3U")) {
    return {
      ok: false,
      signature: null,
    };
  }

  const variantUrl = extractFirstVariantUrl(masterText, playbackUrl);

  if (!variantUrl) {
    return {
      ok: true,
      signature: extractHlsSignature(masterText),
    };
  }

  const mediaText = await fetchTextWithTimeout(variantUrl, 3000);
  if (!mediaText || !mediaText.includes("#EXTM3U")) {
    return {
      ok: false,
      signature: null,
    };
  }

  return {
    ok: true,
    signature: extractHlsSignature(mediaText),
  };
}

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

function getRuntimeBasePath(scope) {
  return scope === "private" ? "privateSession" : "live";
}

function getHostRuntimeForScope(event, scope) {
  return scope === "private"
    ? (event?.privateSession || {})
    : (event?.live || {});
}

async function syncEventViewerCountFromTruth(eventId, viewersNow) {
  try {
    await Event.updateOne(
      { _id: eventId },
      { $set: { viewerCount: Number(viewersNow || 0) } }
    );
  } catch {}
}

async function startHostDisconnectGraceIfNeeded({ event, scope }) {
  const runtime = getHostRuntimeForScope(event, scope);
  const base = getRuntimeBasePath(scope);
  const now = Date.now();

  const lastSeenAt = runtime?.hostLastSeenAt ? new Date(runtime.hostLastSeenAt).getTime() : 0;
  const hostRealtimeState = String(runtime?.hostRealtimeState || "idle").trim().toLowerCase();
  const disconnectState = String(runtime?.hostDisconnectState || "offline").trim().toLowerCase();

  if (!["setup", "joined", "broadcasting"].includes(hostRealtimeState)) {
    return {
      changed: false,
      state: disconnectState || "offline",
      graceExpiresAt: runtime?.hostDisconnectGraceExpiresAt || null,
    };
  }

  if (!lastSeenAt) {
    return { changed: false, state: disconnectState || "offline", graceExpiresAt: runtime?.hostDisconnectGraceExpiresAt || null };
  }

  if (now - lastSeenAt < HOST_STALE_MS) {
    return {
      changed: false,
      state: disconnectState === "grace" ? "online" : disconnectState || "online",
      graceExpiresAt: runtime?.hostDisconnectGraceExpiresAt || null,
    };
  }

  if (disconnectState === "grace" && runtime?.hostDisconnectGraceExpiresAt) {
    return {
      changed: false,
      state: "grace",
      graceExpiresAt: runtime.hostDisconnectGraceExpiresAt,
    };
  }

  const graceStartedAt = new Date();
  const graceExpiresAt = new Date(graceStartedAt.getTime() + HOST_DISCONNECT_GRACE_MS);

  await Event.updateOne(
    { _id: event._id },
    {
      $set: {
        [`${base}.hostDisconnectState`]: "grace",
        [`${base}.hostDisconnectGraceStartedAt`]: graceStartedAt,
        [`${base}.hostDisconnectGraceExpiresAt`]: graceExpiresAt,
      },
    }
  );

  return {
    changed: true,
    state: "grace",
    graceExpiresAt,
  };
}

async function autoFinishEventForHostTimeout({ event, scope }) {
  const now = new Date();
  const privateSessionCounter = getPrivateSessionCounterForScope(event, scope);

  const baseUpdate =
    scope === "private"
      ? {
          $set: {
            status: "finished",
            "privateSession.hostRealtimeState": "ended",
            "privateSession.hostDisconnectState": "offline",
            "privateSession.hostDisconnectGraceStartedAt": null,
            "privateSession.hostDisconnectGraceExpiresAt": null,
            "privateSession.autoFinishReason": "HOST_DISCONNECTED_TIMEOUT",
            "privateSession.endedAt": now,
          },
        }
      : {
          $set: {
            status: "finished",
            "live.endedAt": now,
            "live.hostRealtimeState": "ended",
            "live.hostDisconnectState": "offline",
            "live.hostDisconnectGraceStartedAt": null,
            "live.hostDisconnectGraceExpiresAt": null,
            "live.autoFinishReason": "HOST_DISCONNECTED_TIMEOUT",
          },
        };

  await Event.updateOne(
    { _id: event._id, status: "live" },
    baseUpdate
  );

  await resetRuntimeForScope({
    eventId: event._id,
    scope,
    endedAt: now,
    roomStatus: "ended",
    clearPresence: true,
    privateSessionCounter,
  });

  await syncEventViewerCountFromTruth(event._id, 0);
}

async function evaluateHostLifecycle({ event, scope }) {
  if (String(event?.status || "") !== "live") {
    return {
      hostDisconnectState: "offline",
      hostGraceActive: false,
      hostGraceExpiresAt: null,
      autoFinished: false,
    };
  }

  const runtime = getHostRuntimeForScope(event, scope);
  const base = getRuntimeBasePath(scope);

  let graceResult = await startHostDisconnectGraceIfNeeded({ event, scope });

  const playbackUrl = getCanonicalPlaybackUrl(event);
  const mediaProbe = await probePlaybackUrl(playbackUrl);
  const now = new Date();

  const previousSignature = String(runtime?.hostMediaSignature || "");
  const nextSignature = String(mediaProbe.signature || "");

  const previousChangedAt = runtime?.hostMediaSignatureChangedAt
    ? new Date(runtime.hostMediaSignatureChangedAt).getTime()
    : 0;

  let mediaIsAdvancing = false;
  let mediaChangedAt = previousChangedAt ? new Date(previousChangedAt) : now;

  if (mediaProbe.ok && nextSignature && nextSignature !== previousSignature) {
    mediaIsAdvancing = true;
    mediaChangedAt = now;

    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          [`${base}.hostMediaStatus`]: "live",
          [`${base}.hostMediaSignature`]: nextSignature,
          [`${base}.hostMediaSignatureChangedAt`]: now,
          [`${base}.hostMediaCheckedAt`]: now,
          [`${base}.playbackUrl`]: playbackUrl || null,
        },
      }
    );

    if (String(runtime?.hostDisconnectState || "").toLowerCase() === "grace") {
      await Event.updateOne(
        { _id: event._id },
        {
          $set: {
            [`${base}.hostDisconnectState`]: "online",
            [`${base}.hostDisconnectGraceStartedAt`]: null,
            [`${base}.hostDisconnectGraceExpiresAt`]: null,
            [`${base}.hostMediaStatus`]: "live",
          },
        }
      );

      graceResult = {
        changed: true,
        state: "online",
        graceExpiresAt: null,
      };
    }
  } else {
    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          [`${base}.hostMediaCheckedAt`]: now,
        },
      }
    );
  }

  const hostRealtimeState = String(runtime?.hostRealtimeState || "idle").toLowerCase();
  const shouldExpectMedia = ["broadcasting"].includes(hostRealtimeState);

  const mediaAgeMs = previousChangedAt ? Date.now() - previousChangedAt : 0;
  const mediaLooksDead =
    shouldExpectMedia &&
    (!mediaProbe.ok || !nextSignature || mediaAgeMs > HOST_MEDIA_STALE_MS);

  if (mediaLooksDead) {
    const alreadyGrace =
      String(runtime?.hostDisconnectState || "").toLowerCase() === "grace" &&
      runtime?.hostDisconnectGraceExpiresAt;

    const graceStartedAt = alreadyGrace
      ? runtime.hostDisconnectGraceStartedAt || new Date()
      : new Date();

    const graceExpiresAt = alreadyGrace
      ? runtime.hostDisconnectGraceExpiresAt
      : new Date(new Date(graceStartedAt).getTime() + HOST_DISCONNECT_GRACE_MS);

    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          [`${base}.hostMediaStatus`]: "idle",
          [`${base}.hostDisconnectState`]: "grace",
          [`${base}.hostDisconnectGraceStartedAt`]: graceStartedAt,
          [`${base}.hostDisconnectGraceExpiresAt`]: graceExpiresAt,
        },
      }
    );

    graceResult = {
      changed: true,
      state: "grace",
      graceExpiresAt,
    };
  }

  const disconnectState =
    graceResult?.state ||
    String(runtime?.hostDisconnectState || "offline").trim().toLowerCase();

  const graceExpiresAt =
    graceResult?.graceExpiresAt ||
    runtime?.hostDisconnectGraceExpiresAt ||
    null;

  if (
    disconnectState === "grace" &&
    graceExpiresAt &&
    new Date(graceExpiresAt).getTime() <= Date.now()
  ) {
    await autoFinishEventForHostTimeout({ event, scope });

    return {
      hostDisconnectState: "offline",
      hostGraceActive: false,
      hostGraceExpiresAt: null,
      autoFinished: true,
    };
  }

  return {
    hostDisconnectState: disconnectState || "offline",
    hostGraceActive: disconnectState === "grace",
    hostGraceExpiresAt: disconnectState === "grace" ? graceExpiresAt : null,
    autoFinished: false,
  };
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

function getEventChatEnabledForViewers(event) {
  if (typeof event?.chatEnabledForViewers === "boolean") {
    return event.chatEnabledForViewers;
  }
  return true;
}

function getLiveChatPermissions({ event, user, dbUser, effectiveScope }) {
  const isHost = String(user?._id || "") === String(event?.creatorId || "");
  const isAdmin = String(dbUser?.accountType || user?.accountType || "").toLowerCase() === "admin";

  const mutedUserIds = Array.isArray(event?.mutedUserIds) ? event.mutedUserIds : [];
  const isMuted = mutedUserIds.some((id) => String(id) === String(user?._id || ""));

  const chatEnabledForViewers = getEventChatEnabledForViewers(event);

  const isVip = dbUser?.isVip === true;
  const tokenBalance = Number(dbUser?.tokenBalance || 0);

  const isPaidEvent =
    Number(event?.ticketPriceTokens || 0) > 0 ||
    effectiveScope === "private";

  if (isHost) {
    return { canChat: true, reason: "HOST" };
  }

  if (isAdmin) {
    return { canChat: true, reason: "ADMIN" };
  }

  if (!chatEnabledForViewers) {
    return { canChat: false, reason: "CHAT_DISABLED" };
  }

  if (isMuted) {
    return { canChat: false, reason: "MUTED" };
  }

  if (isPaidEvent) {
    return { canChat: true, reason: "ALLOWED" };
  }

  if (isVip || tokenBalance > 0) {
    return { canChat: true, reason: "ALLOWED" };
  }

  return { canChat: false, reason: "CHAT_NOT_ALLOWED" };
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
 * @route POST /api/live/:eventId/host/session
 * @desc  Returns OME ingest/playback data for host console
 * @access Private
 */
router.post("/:eventId/host/session", auth, featureGuard("live"), async (req, res) => {
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

    const event = await Event.findById(eventId).exec();
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

    if (!OME_RTMP_URL) {
      return res.status(500).json({
        status: "error",
        code: "OME_RTMP_URL_MISSING",
        message: "OME ingest url not configured",
      });
    }

    const base = scope === "private" ? "privateSession" : "live";
    const streamKey = getOmeStreamKey(event);
    const playbackUrl = getCanonicalPlaybackUrl(event);

    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          [`${base}.streamKey`]: streamKey,
          [`${base}.playbackUrl`]: playbackUrl || null,
        },
      }
    );

    return res.status(200).json({
      status: "success",
      data: {
        eventId: String(event._id),
        scope,
        roomId: getRoomIdForScope(event, scope, null),
        rtmpUrl: OME_RTMP_URL,
        streamKey,
        playbackUrl: playbackUrl || null,
        hostMediaStatus: String(event?.[base]?.hostMediaStatus || "idle"),
      },
    });
  } catch (err) {
    console.error("Error during host/session:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while creating host session",
    });
  }
});

/**
 * @route POST /api/live/:eventId/viewer/session
 * @desc  Returns playback url for authorized viewer
 * @access Private
 */
router.post("/:eventId/viewer/session", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ status: "error", message: "Unauthenticated user" });
    }

    const eventId = String(req.params.eventId || "").trim();
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid event ID" });
    }

    const requestedScope = getScopeFromReq(req);

    const event = await Event.findById(eventId).exec();
    if (!event) {
      return res.status(404).json({ status: "error", message: "Event not found" });
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

    const effectiveScope = access.authorizedScope || "public";
    const base = effectiveScope === "private" ? "privateSession" : "live";
    const streamKey = getOmeStreamKey(event);
    const playbackUrl = getCanonicalPlaybackUrl(event);

    const mediaProbe = await probePlaybackUrl(playbackUrl);
    const isLive = mediaProbe.ok;

    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          [`${base}.streamKey`]: streamKey,
          [`${base}.playbackUrl`]: playbackUrl || null,
          [`${base}.hostMediaStatus`]: isLive ? "live" : "idle",
        },
      }
    );

    return res.status(200).json({
      status: "success",
      data: {
        eventId: String(event._id),
        scope: effectiveScope,
        authorizedScope: effectiveScope,
        roomId: getRoomIdForScope(event, effectiveScope, access.authorizedRoomId || null),
        playbackUrl: playbackUrl || null,
        streamKey,
        isLive,
        hostMediaStatus: isLive ? "live" : "idle",
      },
    });
  } catch (err) {
    console.error("Error during viewer/session:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while creating viewer session",
    });
  }
});

/**
 * @route GET /api/live/:eventId/media-status
 * @desc  Probe OME playback and return real media status
 * @access Private
 */
router.get("/:eventId/media-status", auth, featureGuard("live"), async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ status: "error", message: "Unauthenticated user" });
    }

    const eventId = String(req.params.eventId || "").trim();
    if (!eventId || eventId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid event ID" });
    }

    const requestedScope = getScopeFromReq(req);

    const event = await Event.findById(eventId).exec();
    if (!event) {
      return res.status(404).json({ status: "error", message: "Event not found" });
    }

    const isHost = String(user._id) === String(event.creatorId);
    const isAdmin = String(user.accountType || "").toLowerCase() === "admin";

    let effectiveScope = requestedScope;
    let authorizedRoomId = null;

    if (!isHost && !isAdmin) {
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

      effectiveScope = access.authorizedScope || "public";
      authorizedRoomId = access.authorizedRoomId || null;
    }

    const base = effectiveScope === "private" ? "privateSession" : "live";
    const streamKey = getOmeStreamKey(event);
    const playbackUrl = getCanonicalPlaybackUrl(event);

    const mediaProbe = await probePlaybackUrl(playbackUrl);
    const isLive = mediaProbe.ok;

    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          [`${base}.streamKey`]: streamKey,
          [`${base}.playbackUrl`]: playbackUrl || null,
          [`${base}.hostMediaStatus`]: isLive ? "live" : "idle",
        },
      }
    );

    return res.status(200).json({
      status: "success",
      data: {
        eventId: String(event._id),
        scope: effectiveScope,
        roomId: getRoomIdForScope(event, effectiveScope, authorizedRoomId),
        playbackUrl: playbackUrl || null,
        streamKey,
        isLive,
        hostMediaStatus: isLive ? "live" : "idle",
      },
    });
  } catch (err) {
    console.error("Error during media-status:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while checking media status",
    });
  }
});

/**
 * @route POST /api/live/:eventId/start-media
 * @desc Mark host media as started without provider dependency
 * @access Private
 */
router.post("/:eventId/start-media", auth, featureGuard("live"), async (req, res) => {
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
    const playbackUrlRaw = String(req.body?.playbackUrl || "").trim();
    const streamKeyRaw = String(req.body?.streamKey || "").trim();

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

    const base = requestedScope === "private" ? "privateSession" : "live";
    const now = new Date();

    const computedStreamKey = streamKeyRaw || getOmeStreamKey(event);
    const computedPlaybackUrl = getCanonicalPlaybackUrl(event);

    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          [`${base}.hostMediaStatus`]: "live",
          [`${base}.hostRealtimeState`]: "broadcasting",
          [`${base}.hostBroadcastStartedAt`]: now,
          [`${base}.hostLastSeenAt`]: now,
          [`${base}.hostDisconnectState`]: "online",
          [`${base}.hostDisconnectGraceStartedAt`]: null,
          [`${base}.hostDisconnectGraceExpiresAt`]: null,
          [`${base}.playbackUrl`]: computedPlaybackUrl || null,
          [`${base}.streamKey`]: computedStreamKey || null,
        },
      }
    );

    return res.status(200).json({
      status: "success",
      data: {
        eventId: String(event._id),
        scope: requestedScope,
        hostMediaStatus: "live",
        playbackUrl: computedPlaybackUrl || null,
        streamKey: computedStreamKey || null,
      },
    });
  } catch (err) {
    console.error("Error during start-media:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while starting live media",
    });
  }
});

/**
 * @route POST /api/live/:eventId/stop-media
 * @desc Mark host media as stopped without provider dependency
 * @access Private
 */
router.post("/:eventId/stop-media", auth, featureGuard("live"), async (req, res) => {
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

    const base = requestedScope === "private" ? "privateSession" : "live";

    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          [`${base}.hostMediaStatus`]: "idle",
          [`${base}.playbackUrl`]: null,
        },
      }
    );

    return res.status(200).json({
      status: "success",
      data: {
        eventId: String(event._id),
        scope: requestedScope,
        hostMediaStatus: "idle",
      },
    });
  } catch (err) {
    console.error("Error during stop-media:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while stopping live media",
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

    if (["setup", "joined", "broadcasting"].includes(nextState)) {
      await markHostHeartbeat({
        eventId,
        scope,
      });
    }

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
 * @route POST /api/live/:eventId/host-ping
 * @desc Host heartbeat for disconnect grace handling
 * @access Private
 */
router.post("/:eventId/host-ping", auth, featureGuard("live"), async (req, res) => {
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

    const event = await Event.findById(eventId)
      .select("_id creatorId status")
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

    const heartbeatAt = await markHostHeartbeat({
      eventId,
      scope,
    });

    return res.status(200).json({
      status: "success",
      data: {
        eventId,
        scope,
        heartbeatAt,
      },
    });
  } catch (err) {
    console.error("Error during host-ping:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while pinging host state",
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

    const hostLifecycle = await evaluateHostLifecycle({
      event,
      scope: access.authorizedScope,
    });

    if (hostLifecycle.autoFinished) {
      return res.status(410).json({
        status: "error",
        code: "EVENT_ENDED",
        message: "Event ended because host disconnected",
      });
    }

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
    await syncEventViewerCountFromTruth(
      event._id,
      Number(liveRoom.currentViewersCount || 0)
    );

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
        hostDisconnectState: hostLifecycle.hostDisconnectState,
        hostGraceActive: hostLifecycle.hostGraceActive,
        hostGraceExpiresAt: hostLifecycle.hostGraceExpiresAt,
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

    await syncEventViewerCountFromTruth(event._id, Number(viewersNow || 0));

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

    const hostLifecycle = await evaluateHostLifecycle({
      event,
      scope: effectiveScope,
    });

    if (hostLifecycle.autoFinished) {
      return res.status(410).json({
        status: "error",
        code: "EVENT_ENDED",
        message: "Event ended because host disconnected",
      });
    }

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

    await syncEventViewerCountFromTruth(event._id, Number(viewersNow || 0));

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
        hostDisconnectState: hostLifecycle.hostDisconnectState,
        hostGraceActive: hostLifecycle.hostGraceActive,
        hostGraceExpiresAt: hostLifecycle.hostGraceExpiresAt,

        live: event.live
          ? {
              ...event.live,
              provider: undefined,
              meetingId: undefined,
              hostParticipantId: undefined,
              hostParticipantName: undefined,
              hostPresetName: undefined,
              hostLastTokenIssuedAt: undefined,
            }
          : null,

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
                playbackUrl: ps.playbackUrl || null,
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

    const hostLifecycle = await evaluateHostLifecycle({
      event,
      scope: effectiveScope,
    });

    if (hostLifecycle.autoFinished) {
      return res.status(410).json({
        status: "error",
        code: "EVENT_ENDED",
        message: "Event ended because host disconnected",
      });
    }

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

    if (isHost) {
      await markHostHeartbeat({
        eventId: event._id,
        scope: effectiveScope,
      });
    }

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

    await syncEventViewerCountFromTruth(event._id, Number(viewersNow || 0));

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
        hostDisconnectState: hostLifecycle.hostDisconnectState,
        hostGraceActive: hostLifecycle.hostGraceActive,
        hostGraceExpiresAt: hostLifecycle.hostGraceExpiresAt,
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

    const chatPermissions = getLiveChatPermissions({
      event,
      user,
      dbUser,
      effectiveScope,
    });

    if (!chatPermissions.canChat) {
      if (chatPermissions.reason === "CHAT_DISABLED") {
        return res.status(403).json({
          status: "error",
          code: "CHAT_DISABLED",
          message: "Chat is currently disabled for viewers",
        });
      }

      if (chatPermissions.reason === "MUTED") {
        return res.status(403).json({
          status: "error",
          code: "MUTED",
          message: "You are muted in this live chat",
        });
      }

      return res.status(403).json({
        status: "error",
        code: "CHAT_NOT_ALLOWED",
        message: "Chat is reserved to VIP users or users with tokens",
      });
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
