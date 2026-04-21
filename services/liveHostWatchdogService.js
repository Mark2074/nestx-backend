const Event = require("../models/event");
const { resetRuntimeForScope } = require("./liveRuntimeService");

const HOST_STALE_MS = 20 * 1000;
const HOST_DISCONNECT_GRACE_MS = 2 * 60 * 1000;

let watchdogInterval = null;
let watchdogRunning = false;

function getScopeFromEvent(event) {
  return String(event?.accessScope || "public").trim().toLowerCase() === "private"
    ? "private"
    : "public";
}

function getRuntimeForScope(event, scope) {
  return scope === "private"
    ? (event?.privateSession || {})
    : (event?.live || {});
}

function getBasePath(scope) {
  return scope === "private" ? "privateSession" : "live";
}

async function openGraceIfNeeded(event, scope, runtime, nowMs) {
  const lastSeenAtMs = runtime?.hostLastSeenAt
    ? new Date(runtime.hostLastSeenAt).getTime()
    : 0;

  const hostRealtimeState = String(runtime?.hostRealtimeState || "idle").trim().toLowerCase();
  const hostDisconnectState = String(runtime?.hostDisconnectState || "offline").trim().toLowerCase();

  if (!["setup", "joined", "broadcasting"].includes(hostRealtimeState)) {
    return false;
  }

  if (!lastSeenAtMs) {
    return false;
  }

  if (hostDisconnectState === "grace") {
    return false;
  }

  if (nowMs - lastSeenAtMs < HOST_STALE_MS) {
    return false;
  }

  const base = getBasePath(scope);
  const graceStartedAt = new Date(nowMs);
  const graceExpiresAt = new Date(nowMs + HOST_DISCONNECT_GRACE_MS);

  await Event.updateOne(
    { _id: event._id, status: "live" },
    {
      $set: {
        [`${base}.hostDisconnectState`]: "grace",
        [`${base}.hostDisconnectGraceStartedAt`]: graceStartedAt,
        [`${base}.hostDisconnectGraceExpiresAt`]: graceExpiresAt,
      },
    }
  );

  return true;
}

async function finishTimedOutEvent(event, scope, runtime, nowMs) {
  const base = getBasePath(scope);
  const now = new Date(nowMs);
  const privateSessionCounter =
    scope === "private"
      ? Number(event?.privateSessionCounter || 0)
      : null;

  const update =
    scope === "private"
      ? {
          $set: {
            status: "finished",
            viewerCount: 0,
            "privateSession.status": "completed",
            "privateSession.countdownSeconds": 0,
            "privateSession.reservedByUserId": null,
            "privateSession.reservedAt": null,
            "privateSession.reservedExpiresAt": null,
            "privateSession.reservedPriceTokens": null,
            "privateSession.reservedDescription": null,
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
            viewerCount: 0,
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
    update
  );

  await resetRuntimeForScope({
    eventId: event._id,
    scope,
    endedAt: now,
    roomStatus: "ended",
    clearPresence: true,
    privateSessionCounter,
  });

  console.log("[LIVE_HOST_WATCHDOG] auto-finished event", {
    eventId: String(event._id),
    scope,
    reason: "HOST_DISCONNECTED_TIMEOUT",
  });
}

async function checkLiveEventsForTimedOutHosts() {
  if (watchdogRunning) return;
  watchdogRunning = true;

  try {
    const liveEvents = await Event.find({ status: "live" })
      .select("_id status accessScope live privateSession privateSessionCounter")
      .lean()
      .exec();

    const nowMs = Date.now();

    for (const event of liveEvents) {
      const scope = getScopeFromEvent(event);
      const runtimeBefore = getRuntimeForScope(event, scope);
      await openGraceIfNeeded(event, scope, runtimeBefore, nowMs);

      const freshEvent = await Event.findById(event._id)
        .select("_id status accessScope live privateSession privateSessionCounter")
        .lean()
        .exec();

      if (!freshEvent || String(freshEvent.status || "") !== "live") {
        continue;
      }

      const runtimeAfter = getRuntimeForScope(freshEvent, scope);
      const hostDisconnectState = String(runtimeAfter?.hostDisconnectState || "offline").trim().toLowerCase();
      const graceExpiresAtMs = runtimeAfter?.hostDisconnectGraceExpiresAt
        ? new Date(runtimeAfter.hostDisconnectGraceExpiresAt).getTime()
        : 0;

      if (hostDisconnectState === "grace" && graceExpiresAtMs > 0 && graceExpiresAtMs <= nowMs) {
        await finishTimedOutEvent(freshEvent, scope, runtimeAfter, nowMs);
      }
    }
  } catch (err) {
    console.error("[LIVE_HOST_WATCHDOG] error", err?.message || err);
  } finally {
    watchdogRunning = false;
  }
}

function startLiveHostWatchdog() {
  if (watchdogInterval) return;

  watchdogInterval = setInterval(() => {
    void checkLiveEventsForTimedOutHosts();
  }, 5000);

  console.log("[LIVE_HOST_WATCHDOG] started");
}

module.exports = {
  startLiveHostWatchdog,
  checkLiveEventsForTimedOutHosts,
};