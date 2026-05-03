const { releaseEligiblePrivateHeldFunds } = require("../services/privateHeldReleaseService");

let isRunning = false;
let intervalRef = null;

function parseBool(v) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

async function runInternalPrivateReleaseSweep() {
  if (isRunning) return;
  isRunning = true;

  try {
    const result = await releaseEligiblePrivateHeldFunds({ limit: 50 });

    if (result.releasedOps > 0 || result.failed > 0) {
      console.log("[INTERNAL_PRIVATE_RELEASE]", result);
    }
  } catch (err) {
    console.error("[INTERNAL_PRIVATE_RELEASE][ERROR]", err?.message || err);
  } finally {
    isRunning = false;
  }
}

function startInternalPrivateReleaseJob() {
  const enabled =
    parseBool(process.env.RUN_BACKGROUND_JOBS ?? "true") &&
    parseBool(process.env.ENABLE_INTERNAL_PRIVATE_RELEASE_JOB ?? "true");

  if (!enabled) {
    console.log("[INTERNAL_PRIVATE_RELEASE] job disabled");
    return;
  }

  const intervalMs = Math.max(
    Number(process.env.INTERNAL_PRIVATE_RELEASE_INTERVAL_MS || 60000),
    15000
  );

  if (intervalRef) return;

  console.log(`[INTERNAL_PRIVATE_RELEASE] job started every ${intervalMs}ms`);

  runInternalPrivateReleaseSweep();

  intervalRef = setInterval(runInternalPrivateReleaseSweep, intervalMs);
}

module.exports = {
  startInternalPrivateReleaseJob,
};