const Event = require("../models/event");
const { processOneEligibleNativePrivateRelease } = require("../services/nativePrivateEconomicService");

let isRunning = false;
let intervalRef = null;

function parseBool(v) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

async function runNativePrivateReleaseSweep() {
  if (isRunning) return;
  isRunning = true;

  const now = new Date();

  try {
    const eligibleEvents = await Event.find({
      accessScope: "private",
      status: "finished",
      "privateSession.economicStatus": "held",
      "privateSession.economicReleaseEligibleAt": { $lte: now },
    })
      .select("_id privateSession.roomId privateSession.economicReleaseEligibleAt")
      .sort({ "privateSession.economicReleaseEligibleAt": 1 })
      .lean();

    if (!eligibleEvents.length) return;

    for (const ev of eligibleEvents) {
      try {
        const out = await processOneEligibleNativePrivateRelease({
          eventId: ev._id,
          now,
        });

        if (out?.processed) {
          console.log("[NATIVE_PRIVATE_RELEASE][SUCCESS]", JSON.stringify({
            eventId: String(ev._id),
            releasedCount: out.releasedCount || 0,
            releasedTokens: out.releasedTokens || 0,
            releasedToRedeemable: out.releasedToRedeemable || 0,
            releasedToEarnings: out.releasedToEarnings || 0,
            at: now.toISOString(),
          }));
        }
      } catch (err) {
        console.error("[NATIVE_PRIVATE_RELEASE][ERROR]", JSON.stringify({
          eventId: String(ev._id),
          message: err?.message || "unknown_error",
          code: err?.payload?.code || null,
          at: now.toISOString(),
        }));
      }
    }
  } catch (err) {
    console.error("[NATIVE_PRIVATE_RELEASE][SWEEP_ERROR]", err?.message || err);
  } finally {
    isRunning = false;
  }
}

function startNativePrivateReleaseJob() {
  const enabled =
    parseBool(process.env.RUN_BACKGROUND_JOBS ?? "true") &&
    parseBool(process.env.ENABLE_NATIVE_PRIVATE_RELEASE_JOB ?? "true");

  if (!enabled) {
    console.log("[NATIVE_PRIVATE_RELEASE] job disabled");
    return;
  }

  const intervalMs = Math.max(
    Number(process.env.NATIVE_PRIVATE_RELEASE_INTERVAL_MS || 60000),
    15000
  );

  if (intervalRef) return;

  console.log(`[NATIVE_PRIVATE_RELEASE] job started every ${intervalMs}ms`);

  runNativePrivateReleaseSweep().catch((err) => {
    console.error("[NATIVE_PRIVATE_RELEASE][BOOT_RUN_ERROR]", err?.message || err);
  });

  intervalRef = setInterval(() => {
    runNativePrivateReleaseSweep().catch((err) => {
      console.error("[NATIVE_PRIVATE_RELEASE][TICK_ERROR]", err?.message || err);
    });
  }, intervalMs);
}

module.exports = {
  startNativePrivateReleaseJob,
  runNativePrivateReleaseSweep,
};