const Event = require("../models/event");
const LiveRoom = require("../models/LiveRoom");
const LivePresence = require("../models/LivePresence");

function getRuntimeBasePath(scope) {
  return scope === "private" ? "privateSession" : "live";
}

function getRoomRuntimeFromEvent(event, scope) {
  if (scope === "private") {
    return {
      roomId: event?.privateSession?.roomId || null,
      streamKey: event?.privateSession?.streamKey || null,
      playbackUrl: event?.privateSession?.playbackUrl || null,
      hostMediaStatus: event?.privateSession?.hostMediaStatus || "idle",
      hostRealtimeState: event?.privateSession?.hostRealtimeState || "idle",
      hostJoinedAt: event?.privateSession?.hostJoinedAt || null,
      hostBroadcastStartedAt: event?.privateSession?.hostBroadcastStartedAt || null,
      hostLastSeenAt: event?.privateSession?.hostLastSeenAt || null,
      hostDisconnectState: event?.privateSession?.hostDisconnectState || "offline",
      hostDisconnectGraceStartedAt: event?.privateSession?.hostDisconnectGraceStartedAt || null,
      hostDisconnectGraceExpiresAt: event?.privateSession?.hostDisconnectGraceExpiresAt || null,
      autoFinishReason: event?.privateSession?.autoFinishReason || null,
      endedAt: event?.privateSession?.endedAt || null,
    };
  }

  return {
    roomId: event?.live?.roomId || String(event?._id || ""),
    streamKey: event?.live?.streamKey || null,
    playbackUrl: event?.live?.playbackUrl || null,
    hostMediaStatus: event?.live?.hostMediaStatus || "idle",
    hostRealtimeState: event?.live?.hostRealtimeState || "idle",
    hostJoinedAt: event?.live?.hostJoinedAt || null,
    hostBroadcastStartedAt: event?.live?.hostBroadcastStartedAt || null,
    hostLastSeenAt: event?.live?.hostLastSeenAt || null,
    hostDisconnectState: event?.live?.hostDisconnectState || "offline",
    hostDisconnectGraceStartedAt: event?.live?.hostDisconnectGraceStartedAt || null,
    hostDisconnectGraceExpiresAt: event?.live?.hostDisconnectGraceExpiresAt || null,
    autoFinishReason: event?.live?.autoFinishReason || null,
    endedAt: event?.live?.endedAt || null,
  };
}

async function resetRuntimeForScope({
  eventId,
  scope,
  endedAt = null,
  roomStatus = null,
  clearPresence = false,
  privateSessionCounter = null,
}) {
  const base = getRuntimeBasePath(scope);

  const setPayload = {
    [`${base}.streamKey`]: null,
    [`${base}.playbackUrl`]: null,
    [`${base}.hostMediaStatus`]: "idle",
    [`${base}.hostRealtimeState`]: "idle",
    [`${base}.hostJoinedAt`]: null,
    [`${base}.hostBroadcastStartedAt`]: null,
    [`${base}.hostLastSeenAt`]: null,
    [`${base}.hostDisconnectState`]: "offline",
    [`${base}.hostDisconnectGraceStartedAt`]: null,
    [`${base}.hostDisconnectGraceExpiresAt`]: null,
    [`${base}.autoFinishReason`]: null,
  };

  if (endedAt) {
    setPayload[`${base}.endedAt`] = endedAt;
  }

  await Event.updateOne(
    { _id: eventId },
    { $set: setPayload }
  );

  const roomFilter = {
    eventId,
    scope,
  };

  if (scope === "private") {
    roomFilter.privateSessionCounter = Number(privateSessionCounter || 0);
  }

  const roomUpdate = {
    $set: {
      currentViewersCount: 0,
    },
  };

  if (roomStatus) {
    roomUpdate.$set.status = roomStatus;
  }

  await LiveRoom.updateMany(roomFilter, roomUpdate);

  if (clearPresence) {
    const presenceFilter = {
      eventId,
      scope,
      status: "active",
    };

    if (scope === "private") {
      presenceFilter.privateSessionCounter = Number(privateSessionCounter || 0);
    }

    await LivePresence.updateMany(
      presenceFilter,
      {
        $set: {
          status: "left",
          leftAt: new Date(),
        },
      }
    );
  }
}

async function markHostHeartbeat({
  eventId,
  scope,
}) {
  const base = getRuntimeBasePath(scope);
  const now = new Date();

  await Event.updateOne(
    { _id: eventId },
    {
      $set: {
        [`${base}.hostLastSeenAt`]: now,
        [`${base}.hostDisconnectState`]: "online",
        [`${base}.hostDisconnectGraceStartedAt`]: null,
        [`${base}.hostDisconnectGraceExpiresAt`]: null,
      },
    }
  );

  return now;
}

async function saveHostRuntimeOnEvent({
  eventId,
  scope,
  hostRealtimeState,
  hostJoinedAt,
  hostBroadcastStartedAt,
  hostLastSeenAt,
  hostDisconnectState,
  hostDisconnectGraceStartedAt,
  hostDisconnectGraceExpiresAt,
  autoFinishReason,
  hostMediaStatus,
  playbackUrl,
  streamKey,
}) {
  const base = getRuntimeBasePath(scope);

  const payload = {
    [`${base}.hostRealtimeState`]: hostRealtimeState ?? "idle",
    [`${base}.hostJoinedAt`]: hostJoinedAt ?? null,
    [`${base}.hostBroadcastStartedAt`]: hostBroadcastStartedAt ?? null,
    [`${base}.hostLastSeenAt`]: hostLastSeenAt ?? null,
    [`${base}.hostDisconnectState`]: hostDisconnectState ?? "offline",
    [`${base}.hostDisconnectGraceStartedAt`]: hostDisconnectGraceStartedAt ?? null,
    [`${base}.hostDisconnectGraceExpiresAt`]: hostDisconnectGraceExpiresAt ?? null,
    [`${base}.autoFinishReason`]: autoFinishReason ?? null,
    [`${base}.hostMediaStatus`]: hostMediaStatus ?? "idle",
    [`${base}.playbackUrl`]: playbackUrl ?? null,
    [`${base}.streamKey`]: streamKey ?? null,
  };

  await Event.updateOne(
    { _id: eventId },
    { $set: payload }
  );
}

async function markHostRealtimeState({
  eventId,
  scope,
  state,
  broadcastStarted = false,
}) {
  const currentEvent = await Event.findById(eventId).lean().exec();
  if (!currentEvent) return;

  const current = getRoomRuntimeFromEvent(currentEvent, scope);
  const normalizedState = String(state || "idle").trim().toLowerCase();
  const now = new Date();

  const isActive =
    normalizedState === "joined" || normalizedState === "broadcasting";

  await saveHostRuntimeOnEvent({
    eventId,
    scope,
    hostRealtimeState: normalizedState,
    hostJoinedAt: isActive ? (current?.hostJoinedAt || now) : null,
    hostBroadcastStartedAt:
      broadcastStarted || normalizedState === "broadcasting"
        ? (current?.hostBroadcastStartedAt || now)
        : current?.hostBroadcastStartedAt || null,
    hostLastSeenAt: isActive ? now : null,
    hostDisconnectState: isActive ? "online" : "offline",
    hostDisconnectGraceStartedAt: null,
    hostDisconnectGraceExpiresAt: null,
    autoFinishReason: normalizedState === "ended" ? "HOST_ENDED" : null,
    hostMediaStatus: normalizedState === "broadcasting" ? "live" : "idle",
    playbackUrl: current?.playbackUrl || null,
    streamKey: current?.streamKey || null,
  });
}

module.exports = {
  getRuntimeBasePath,
  getRoomRuntimeFromEvent,
  resetRuntimeForScope,
  markHostHeartbeat,
  markHostRealtimeState,
  saveHostRuntimeOnEvent,
};