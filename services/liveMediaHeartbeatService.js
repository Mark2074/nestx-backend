const Event = require("../models/event");
const LiveRoom = require("../models/LiveRoom");
const LivePresence = require("../models/LivePresence");

const CHECK_INTERVAL_MS = 5 * 1000;
const MEDIA_STALE_MS = 15 * 1000;
const MEDIA_GRACE_MS = 120 * 1000;

let intervalRef = null;
let running = false;

const OME_PLAYBACK_BASE_URL = String(process.env.OME_PLAYBACK_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

const OME_MANIFEST_NAME =
  String(process.env.OME_MANIFEST_NAME || "ts:playlist.m3u8").trim() ||
  "ts:playlist.m3u8";

function buildPlaybackUrl(eventId) {
  const id = String(eventId || "").trim();
  if (!OME_PLAYBACK_BASE_URL || !id) return null;
  return `${OME_PLAYBACK_BASE_URL}/${id}/${OME_MANIFEST_NAME}`;
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
  try {
    return new URL(String(childUrl || "").trim(), baseUrl).toString();
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
  if (!playbackUrl) return { ok: false, signature: null };

  const masterText = await fetchTextWithTimeout(playbackUrl, 3000);
  if (!masterText || !masterText.includes("#EXTM3U")) {
    return { ok: false, signature: null };
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
    return { ok: false, signature: null };
  }

  return {
    ok: true,
    signature: extractHlsSignature(mediaText),
  };
}

async function finishEventForMediaTimeout(event) {
  const now = new Date();

  await Event.updateOne(
    {
      _id: event._id,
      status: "live",
      "live.mediaGraceExpiresAt": { $ne: null, $lte: now },
    },
    {
      $set: {
        status: "finished",
        endedAt: now,
        actualLiveEndTime: now,

        "live.mediaState": "offline",
        "live.mediaGraceStartedAt": null,
        "live.mediaGraceExpiresAt": null,
        "live.hostMediaStatus": "idle",
        "live.hostRealtimeState": "ended",
        "live.hostDisconnectState": "offline",
        "live.hostDisconnectGraceStartedAt": null,
        "live.hostDisconnectGraceExpiresAt": null,
        "live.autoFinishReason": "MEDIA_OFFLINE_TIMEOUT",
        "live.endedAt": now,
      },
    }
  );

  await LiveRoom.updateMany(
    { eventId: event._id },
    {
      $set: {
        status: "ended",
        currentViewersCount: 0,
      },
    }
  );

  await LivePresence.updateMany(
    {
      eventId: event._id,
      status: "active",
    },
    {
      $set: {
        status: "left",
        leftAt: now,
      },
    }
  );

  await Event.updateOne(
    { _id: event._id },
    { $set: { viewerCount: 0 } }
  );
}

async function checkOneLiveEvent(event) {
  const now = new Date();
  const nowMs = now.getTime();

  const playbackUrl =
    String(event?.live?.playbackUrl || "").trim() ||
    buildPlaybackUrl(event._id);

  const probe = await probePlaybackUrl(playbackUrl);
  const previousSignature = String(event?.live?.mediaSignature || "");
  const nextSignature = String(probe?.signature || "");

  const signatureMoved =
    probe.ok &&
    nextSignature &&
    nextSignature !== previousSignature;

  const firstValidSignal =
    probe.ok &&
    nextSignature &&
    !previousSignature &&
    !event?.live?.mediaLastSeenAt;

  if (signatureMoved || firstValidSignal) {
    await Event.updateOne(
      { _id: event._id, status: "live" },
      {
        $set: {
          "live.playbackUrl": playbackUrl,
          "live.mediaState": "live",
          "live.mediaLastSeenAt": now,
          "live.mediaGraceStartedAt": null,
          "live.mediaGraceExpiresAt": null,
          "live.mediaSignature": nextSignature,
          "live.mediaCheckedAt": now,

          // compatibilità vecchia UI
          "live.hostMediaStatus": "live",
          "live.hostDisconnectState": "online",
          "live.hostDisconnectGraceStartedAt": null,
          "live.hostDisconnectGraceExpiresAt": null,
        },
      }
    );

    return;
  }

  await Event.updateOne(
    { _id: event._id, status: "live" },
    {
      $set: {
        "live.playbackUrl": playbackUrl,
        "live.mediaCheckedAt": now,
        ...(nextSignature ? { "live.mediaSignature": nextSignature } : {}),
      },
    }
  );

  const lastSeenMs = event?.live?.mediaLastSeenAt
    ? new Date(event.live.mediaLastSeenAt).getTime()
    : 0;

  if (lastSeenMs && nowMs - lastSeenMs < MEDIA_STALE_MS) {
    return;
  }

  const graceExpiresAt = event?.live?.mediaGraceExpiresAt
    ? new Date(event.live.mediaGraceExpiresAt)
    : null;

  if (graceExpiresAt) {
    if (graceExpiresAt.getTime() <= nowMs) {
      await finishEventForMediaTimeout(event);
    }

    return;
  }

  const graceStartedAt = now;
  const nextGraceExpiresAt = new Date(nowMs + MEDIA_GRACE_MS);

  await Event.updateOne(
    {
      _id: event._id,
      status: "live",
      "live.mediaGraceExpiresAt": null,
    },
    {
      $set: {
        "live.mediaState": "offline",
        "live.mediaGraceStartedAt": graceStartedAt,
        "live.mediaGraceExpiresAt": nextGraceExpiresAt,
        "live.mediaCheckedAt": now,

        // compatibilità vecchia UI
        "live.hostMediaStatus": "idle",
        "live.hostDisconnectState": "grace",
        "live.hostDisconnectGraceStartedAt": graceStartedAt,
        "live.hostDisconnectGraceExpiresAt": nextGraceExpiresAt,
      },
    }
  );
}

async function tickLiveMediaHeartbeat() {
  if (running) return;
  running = true;

  try {
    const events = await Event.find({ status: "live" })
      .select("_id status live")
      .lean()
      .exec();

    for (const event of events) {
      try {
        await checkOneLiveEvent(event);
      } catch (err) {
        console.error("liveMediaHeartbeat event error:", {
          eventId: String(event?._id || ""),
          message: err?.message || err,
        });
      }
    }
  } catch (err) {
    console.error("liveMediaHeartbeat tick error:", err?.message || err);
  } finally {
    running = false;
  }
}

function startLiveMediaHeartbeatService() {
  if (intervalRef) return;

  console.log("✅ Live media heartbeat service started");

  tickLiveMediaHeartbeat();

  intervalRef = setInterval(() => {
    tickLiveMediaHeartbeat();
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  startLiveMediaHeartbeatService,
  tickLiveMediaHeartbeat,
};