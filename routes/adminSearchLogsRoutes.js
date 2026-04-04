const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const ProhibitedSearchLog = require("../models/ProhibitedSearchLog");

// GET /api/admin/prohibited-search/logs?userId=&limit=50&skip=0
router.get("/prohibited-search/logs", auth, adminGuard, async (req, res) => {
  try {
    const userId = req.query.userId ? String(req.query.userId).trim() : null;

    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 200));
    const skip = Math.max(0, parseInt(req.query.skip || "0", 10));

    const query = {};
    if (userId) query.userId = userId;

    const [items, total] = await Promise.all([
      ProhibitedSearchLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ProhibitedSearchLog.countDocuments(query),
    ]);

    return res.json({ status: "ok", total, limit, skip, items });
  } catch (err) {
    console.error("Admin prohibited search logs error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
