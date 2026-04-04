const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const PlatformUpdate = require("../models/platformUpdate");

/**
 * POST /api/admin/updates
 * body: { text }
 */
router.post("/updates", auth, adminGuard, async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ status: "error", message: "text is required" });
    if (text.length > 220) return res.status(400).json({ status: "error", message: "text too long" });

    const item = await PlatformUpdate.create({ text, isActive: true });
    return res.status(201).json({ status: "success", data: item });
  } catch (err) {
    console.error("admin updates create error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * GET /api/admin/updates
 */
router.get("/updates", auth, adminGuard, async (req, res) => {
  try {
    const items = await PlatformUpdate.find({}).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ status: "success", data: items });
  } catch (err) {
    console.error("admin updates list error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/updates/:id
 * body: { text?, isActive? }
 */
router.patch("/updates/:id", auth, adminGuard, async (req, res) => {
  try {
    const id = req.params.id;

    const patch = {};
    if (req.body?.text !== undefined) {
      const text = String(req.body.text || "").trim();
      if (!text) return res.status(400).json({ status: "error", message: "text cannot be empty" });
      if (text.length > 220) return res.status(400).json({ status: "error", message: "text too long" });
      patch.text = text;
    }

    if (req.body?.isActive !== undefined) {
      patch.isActive = req.body.isActive === true || String(req.body.isActive).toLowerCase() === "true";
    }

    const item = await PlatformUpdate.findByIdAndUpdate(id, patch, { new: true }).lean();
    if (!item) return res.status(404).json({ status: "error", message: "Update not found" });

    return res.status(200).json({ status: "success", data: item });
  } catch (err) {
    console.error("admin updates patch error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * DELETE /api/admin/updates/:id  (opzionale)
 */
router.delete("/updates/:id", auth, adminGuard, async (req, res) => {
  try {
    const id = req.params.id;
    const ok = await PlatformUpdate.findByIdAndDelete(id);
    if (!ok) return res.status(404).json({ status: "error", message: "Update not found" });
    return res.status(200).json({ status: "success" });
  } catch (err) {
    console.error("admin updates delete error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;