const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");
const Notification = require("../models/notification");
const mongoose = require("mongoose");

/**
 * GET /api/admin/notifications/pending
 * Queue unica admin: Notification con userId=null e isRead=false
 */
router.get("/pending", auth, adminGuard, async (req, res) => {
  try {
    const limitRaw = parseInt(req.query.limit || "100", 10);
    const limit = Math.max(1, Math.min(limitRaw, 200));

    const type = (req.query?.type || "").toString().trim();

    const query = {
      userId: null,
      isRead: false,
    };

    if (type) {
      query.type = type;
    }

    const items = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ status: "ok", count: items.length, data: items });
  } catch (err) {
    console.error("admin notifications pending error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/notifications/:id/read
 */
router.patch("/:id/read", auth, adminGuard, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: "error", message: "Invalid notificationId" });
    }

    const n = await Notification.findByIdAndUpdate(
      id,
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    ).lean();

    if (!n) return res.status(404).json({ status: "error", message: "Notification not found" });

    return res.json({ status: "ok", data: n });
  } catch (err) {
    console.error("admin notification read error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/notifications/read-bulk
 * Body: { ids: ["id1","id2"] }
 */
router.patch("/read-bulk", auth, adminGuard, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));

    if (!validIds.length) {
      return res.status(400).json({ status: "error", message: "Invalid ids" });
    }

    const result = await Notification.updateMany(
      { _id: { $in: validIds }, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.json({
      status: "ok",
      modified: result.modifiedCount ?? result.nModified ?? 0,
    });
  } catch (err) {
    console.error("admin notification read-bulk error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
