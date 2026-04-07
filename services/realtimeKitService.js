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

function getRoomRuntimeFromEvent(event, scope) {
  if (scope === "private") {
    return {
      roomId: event?.privateSession?.roomId || null,
      meetingId: event?.privateSession?.meetingId || null,
      provider: event?.privateSession?.provider || "cloudflare",
    };
  }

  return {
    roomId: event?.live?.roomId || String(event?._id || ""),
    meetingId: event?.live?.meetingId || null,
    provider: event?.live?.provider || "cloudflare",
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

async function createMeetingForRoom({ title }) {
  const cfg = getRealtimeKitConfig();
  const apiBase = buildApiBase(cfg);

  const response = await cfFetchJson(`${apiBase}/meetings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.apiToken}`,
    },
    body: JSON.stringify({
      title,
    }),
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

  const suffix = scope === "private"
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

function getPresetNameForRole(role) {
  const cfg = getRealtimeKitConfig();

  if (role === "host") {
    return cfg.publisherPreset;
  }

  return cfg.viewerPreset;
}

function buildParticipantName(user) {
  const displayName = String(user?.displayName || "").trim();
  if (displayName) return displayName.slice(0, 80);
  return `User ${String(user?._id || "").slice(-6)}`;
}

function buildCustomParticipantId(user) {
  return `user_${String(user?._id || "")}`;
}

async function createParticipantToken({ meetingId, user, role }) {
  const cfg = getRealtimeKitConfig();
  const apiBase = buildApiBase(cfg);
  const presetName = getPresetNameForRole(role);

  const response = await cfFetchJson(
    `${apiBase}/meetings/${meetingId}/participants`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.apiToken}`,
      },
      body: JSON.stringify({
        name: buildParticipantName(user),
        preset_name: presetName,
        custom_participant_id: buildCustomParticipantId(user),
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
    raw: participant,
  };
}

module.exports = {
  getRealtimeKitConfig,
  getRoomRuntimeFromEvent,
  ensureMeetingForRoom,
  createParticipantToken,
};