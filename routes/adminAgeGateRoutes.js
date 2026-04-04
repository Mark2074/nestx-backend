const express = require("express");
const router = express.Router();
const AgeGateLog = require("../models/ageGateLog");
const auth = require("../middleware/authMiddleware");

// semplice guard admin (coerente con tuo sistema)
function adminOnly(req, res, next) {
  if (req.user?.accountType !== "admin") {
    return res.status(403).json({ status: "error", message: "Forbidden" });
  }
  next();
}

// GET /api/admin/age-gate-logs
router.get("/age-gate-logs", auth, adminOnly, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const minAttempts = Math.max(1, Number(req.query.minAttempts || 2));
    const sort = String(req.query.sort || "newest");
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));

    const filter = {
      failedUnderageAttempts: { $gte: minAttempts },
    };

    if (q) {
      filter.email = { $regex: q, $options: "i" };
    }

    let sortObj = { updatedAt: -1 };
    if (sort === "oldest") sortObj = { updatedAt: 1 };
    if (sort === "mostAttempts") sortObj = { failedUnderageAttempts: -1, updatedAt: -1 };

    const logs = await AgeGateLog.find(filter)
      .populate("userId", "_id displayName username")
      .sort(sortObj)
      .limit(limit)
      .lean();

    return res.json({
      status: "ok",
      logs,
      total: logs.length,
    });
  } catch (err) {
    console.error("Errore age-gate-logs:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;