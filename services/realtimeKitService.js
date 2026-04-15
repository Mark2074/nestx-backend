const Event = require("../models/event");

function getRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    const err = new Error(`Missing required env: ${name}`);
    err.code = "MISSING_ENV";
    throw err;
  }
  return value;
}

function getRealtimeKitConfig() {
  return {
    accountId: getRequiredEnv("CF_ACCOUNT_ID"),
    appId: getRequiredEnv("CF_REALTIME_APP_ID"),
    apiToken: getRequiredEnv("CF_REALTIME_API_TOKEN"),
    publisherPreset: getRequiredEnv("CF_REALTIME_PUBLISHER_PRESET"),
    viewerPreset: getRequiredEnv("CF_REALTIME_VIEWER_PRESET"),
  };
}

function buildApiBase({ accountId, appId }) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/realtime/kit/${appId}`;
}

async function cfFetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(
      data?.errors?.[0]?.message ||
      data?.result?.message ||
      `Cloudflare API error (${res.status})`
    );
    err.code = "CF_API_ERROR";
    err.httpStatus = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

function buildParticipantName(user) {
  const displayName = String(user?.displayName || "").trim();
  if (displayName) return displayName.slice(0, 80);
  return `User ${String(user?._id || "").slice(-6)}`;
}

function buildCustomParticipantId(user, role) {
  const userId = String(user?._id || "").trim();
  if (role === "host") return `host_${userId}`;
  return `viewer_${userId}_${Date.now()}`;
}

function getPresetNameForRole(role) {
  const cfg = getRealtimeKitConfig();
  return role === "host" ? cfg.publisherPreset : cfg.viewerPreset;
}

function getRoomRuntimeFromEvent(event, scope) {
  if (scope === "private") {
    return {
      roomId: event?.privateSession?.roomId || null,
      meetingId: event?.privateSession?.meetingId || null,
      provider: event?.privateSession?.provider || "cloudflare",
      hostParticipantId: event?.privateSession?.hostParticipantId || null,
      hostParticipantName: event?.privateSession?.hostParticipantName || null,
      hostPresetName: event?.privateSession?.hostPresetName || null,
      hostRealtimeState: event?.privateSession?.hostRealtimeState || "idle",
      hostJoinedAt: event?.privateSession?.hostJoinedAt || null,
      hostBroadcastStartedAt: event?.privateSession?.hostBroadcastStartedAt || null,
      hostLastTokenIssuedAt: event?.privateSession?.hostLastTokenIssuedAt || null,
    };
  }

  return {
    roomId: event?.live?.roomId || String(event?._id || ""),
    meetingId: event?.live?.meetingId || null,
    provider: event?.live?.provider || "cloudflare",
    hostParticipantId: event?.live?.hostParticipantId || null,
    hostParticipantName: event?.live?.hostParticipantName || null,
    hostPresetName: event?.live?.hostPresetName || null,
    hostRealtimeState: event?.live?.hostRealtimeState || "idle",
    hostJoinedAt: event?.live?.hostJoinedAt || null,
    hostBroadcastStartedAt: event?.live?.hostBroadcastStartedAt || null,
    hostLastTokenIssuedAt: event?.live?.hostLastTokenIssuedAt || null,
  };
}

async function saveMeetingIdOnEvent({ eventId, scope, meetingId }) {
  if (scope === "private") {
    await Event.updateOne(
      { _id: eventId },
      {
        $set: {
          "privateSession.meetingId": meetingId,
          "privateSession.provider": "cloudflare",
        },
      }
    );
    return;
  }

  await Event.updateOne(
    { _id: eventId },
    {
      $set: {
        "live.meetingId": meetingId,
        "live.provider": "cloudflare",
      },
    }
  );
}

async function saveHostRuntimeOnEvent({
  eventId,
  scope,
  hostParticipantId,
  hostParticipantName,
  hostPresetName,
  hostRealtimeState,
  hostJoinedAt,
  hostBroadcastStartedAt,
  hostLastTokenIssuedAt,
}) {
  const base =
    scope === "private"
      ? "privateSession"
      : "live";

  await Event.updateOne(
    { _id: eventId },
    {
      $set: {
        [`${base}.provider`]: "cloudflare",
        [`${base}.hostParticipantId`]: hostParticipantId ?? null,
        [`${base}.hostParticipantName`]: hostParticipantName ?? null,
        [`${base}.hostPresetName`]: hostPresetName ?? null,
        [`${base}.hostRealtimeState`]: hostRealtimeState ?? "idle",
        [`${base}.hostJoinedAt`]: hostJoinedAt ?? null,
        [`${base}.hostBroadcastStartedAt`]: hostBroadcastStartedAt ?? null,
        [`${base}.hostLastTokenIssuedAt`]: hostLastTokenIssuedAt ?? null,
      },
    }
  );
}

async function createMeetingForRoom({ title }) {
  const cfg = getRealtimeKitConfig();
  const apiBase = buildApiBase(cfg);

  const response = await cfFetchJson(`${apiBase}/meetings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.apiToken}`,
    },
    body: JSON.stringify({ title }),
  });

  const meetingId =
    response?.data?.id ||
    response?.data?.meetingId ||
    response?.result?.id ||
    response?.result?.meetingId ||
    null;

  if (!meetingId) {
    const err = new Error("Cloudflare meeting ID missing in response");
    err.code = "CF_MEETING_ID_MISSING";
    throw err;
  }

  return {
    meetingId,
    raw: response?.data || response?.result || null,
  };
}

async function ensureMeetingForRoom({ event, scope }) {
  const current = getRoomRuntimeFromEvent(event, scope);

  if (current.meetingId) {
    return {
      meetingId: current.meetingId,
      roomId: current.roomId,
      provider: current.provider || "cloudflare",
      created: false,
    };
  }

  const suffix =
    scope === "private"
      ? (event?.privateSession?.roomId || `${event._id}_private`)
      : (event?.live?.roomId || String(event._id));

  const title = `NestX ${scope} ${suffix}`;
  const createdMeeting = await createMeetingForRoom({ title });

  await saveMeetingIdOnEvent({
    eventId: event._id,
    scope,
    meetingId: createdMeeting.meetingId,
  });

  return {
    meetingId: createdMeeting.meetingId,
    roomId: current.roomId,
    provider: "cloudflare",
    created: true,
  };
}

async function createParticipantToken({ meetingId, user, role, customParticipantIdOverride = null }) {
  const cfg = getRealtimeKitConfig();
  const apiBase = buildApiBase(cfg);
  const presetName = getPresetNameForRole(role);
  const participantName = buildParticipantName(user);
  const customParticipantId =
    String(customParticipantIdOverride || "").trim() ||
    buildCustomParticipantId(user, role);

  const response = await cfFetchJson(
    `${apiBase}/meetings/${meetingId}/participants`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.apiToken}`,
      },
      body: JSON.stringify({
        name: participantName,
        preset_name: presetName,
        custom_participant_id: customParticipantId,
      }),
    }
  );

  const participant = response?.data || response?.result || null;
  const participantId = participant?.id || null;
  const token = participant?.token || participant?.authToken || null;

  if (!participantId || !token) {
    const err = new Error("Cloudflare participant token missing in response");
    err.code = "CF_PARTICIPANT_TOKEN_MISSING";
    throw err;
  }

  return {
    participantId,
    token,
    presetName,
    participantName,
    customParticipantId,
    raw: participant,
  };
}

async function ensureHostParticipantForRoom({ event, scope, user, meetingId }) {
  const current = getRoomRuntimeFromEvent(event, scope);

  const created = await createParticipantToken({
    meetingId,
    user,
    role: "host",
    customParticipantIdOverride: `host_${String(event._id)}`,
  });

  const hostParticipantId =
    String(current?.hostParticipantId || "").trim() ||
    created.participantId;

  const hostRealtimeState = String(current?.hostRealtimeState || "idle").trim().toLowerCase();

  await saveHostRuntimeOnEvent({
    eventId: event._id,
    scope,
    hostParticipantId,
    hostParticipantName: current?.hostParticipantName || created.participantName,
    hostPresetName: current?.hostPresetName || created.presetName,
    hostRealtimeState: hostRealtimeState === "idle" ? "setup" : hostRealtimeState,
    hostJoinedAt: current?.hostJoinedAt || new Date(),
    hostBroadcastStartedAt: current?.hostBroadcastStartedAt || null,
    hostLastTokenIssuedAt: new Date(),
  });

  return {
    participantId: hostParticipantId,
    reused: !!current?.hostParticipantId,
    presetName: current?.hostPresetName || created.presetName,
    participantName: current?.hostParticipantName || created.participantName,
    token: created.token,
  };
}

async function issueViewerParticipantToken({ meetingId, user }) {
  return createParticipantToken({
    meetingId,
    user,
    role: "viewer",
  });
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

  await saveHostRuntimeOnEvent({
    eventId,
    scope,
    hostParticipantId: current?.hostParticipantId || null,
    hostParticipantName: current?.hostParticipantName || null,
    hostPresetName: current?.hostPresetName || null,
    hostRealtimeState: state,
    hostJoinedAt: current?.hostJoinedAt || null,
    hostBroadcastStartedAt:
      broadcastStarted
        ? (current?.hostBroadcastStartedAt || new Date())
        : (current?.hostBroadcastStartedAt || null),
    hostLastTokenIssuedAt: current?.hostLastTokenIssuedAt || null,
  });
}

module.exports = {
  getRealtimeKitConfig,
  getRoomRuntimeFromEvent,
  ensureMeetingForRoom,
  ensureHostParticipantForRoom,
  issueViewerParticipantToken,
  markHostRealtimeState,
};