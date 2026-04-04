const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const SensitiveDictionaryEntry = require("../models/SensitiveDictionaryEntry");

// GET /api/admin/dictionary?active=1&q=teen&limit=50&skip=0
router.get("/dictionary", auth, adminGuard, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const activeRaw = String(req.query.active || "").trim();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 200));
    const skip = Math.max(0, parseInt(req.query.skip || "0", 10));

    const query = {};
    if (activeRaw === "1") query.isActive = true;
    if (activeRaw === "0") query.isActive = false;
    if (q) query.pattern = { $regex: q, $options: "i" };

    const [items, total] = await Promise.all([
      SensitiveDictionaryEntry.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      SensitiveDictionaryEntry.countDocuments(query),
    ]);

    return res.json({ status: "ok", total, limit, skip, items });
  } catch (err) {
    console.error("Admin dictionary list error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/admin/dictionary
router.post("/dictionary", auth, adminGuard, async (req, res) => {
  try {
    const { pattern, matchType, severity, category, isActive, note } = req.body;

    const p = String(pattern || "").trim().toLowerCase();
    if (!p) return res.status(400).json({ status: "error", message: "pattern required" });

    const doc = await SensitiveDictionaryEntry.create({
      pattern: p,
      matchType: matchType === "regex" ? "regex" : "plain",
      severity: severity === "gravissimo" ? "gravissimo" : "grave",
      category: category ? String(category).trim().toLowerCase() : null,
      isActive: typeof isActive === "boolean" ? isActive : true,
      note: note ? String(note).trim() : null,
      updatedByAdminId: req.user._id,
    });

    return res.status(201).json({ status: "ok", item: doc });
  } catch (err) {
    // duplicate key
    if (err && err.code === 11000) {
      return res.status(409).json({ status: "error", message: "pattern already exists" });
    }
    console.error("Admin dictionary create error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// PATCH /api/admin/dictionary/:id
router.patch("/dictionary/:id", auth, adminGuard, async (req, res) => {
  try {
    const { pattern, matchType, severity, category, isActive, note } = req.body;

    const patch = { updatedByAdminId: req.user._id };

    if (pattern != null) {
      const p = String(pattern || "").trim().toLowerCase();
      if (!p) return res.status(400).json({ status: "error", message: "pattern invalid" });
      patch.pattern = p;
    }
    if (matchType != null) patch.matchType = matchType === "regex" ? "regex" : "plain";
    if (severity != null) patch.severity = severity === "gravissimo" ? "gravissimo" : "grave";
    if (category !== undefined) patch.category = category ? String(category).trim().toLowerCase() : null;
    if (typeof isActive === "boolean") patch.isActive = isActive;
    if (note !== undefined) patch.note = note ? String(note).trim() : null;

    const updated = await SensitiveDictionaryEntry.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!updated) return res.status(404).json({ status: "error", message: "not found" });

    return res.json({ status: "ok", item: updated });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ status: "error", message: "pattern already exists" });
    }
    console.error("Admin dictionary update error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
