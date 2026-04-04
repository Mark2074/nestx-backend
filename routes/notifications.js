// routes/notifications.js
const express = require("express");
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const Notification = require("../models/notification");

const router = express.Router();

/**
 * GET /api/notifications
 * query: ?limit=20&cursor=<ISO date>&unreadOnly=1
 * - cursor = createdAt (ISO) dell'ultimo elemento già visto (paginazione semplice)
 */
router.get("/", auth, async (req, res) => {
  try {
    const me = req.user?._id;
    if (!me) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
    const unreadOnly = String(req.query.unreadOnly || "") === "1";

    const cursor = req.query.cursor ? new Date(String(req.query.cursor)) : null;

    const q = { userId: me };
    if (unreadOnly) q.isRead = false;
    if (cursor && !Number.isNaN(cursor.getTime())) q.createdAt = { $lt: cursor };

    const items = await Notification.find(q)
      .sort({ createdAt: -1 })
      .populate("actorId", "username displayName avatar")
      .limit(limit)
      .lean();

    const nextCursor = items.length ? items[items.length - 1].createdAt.toISOString() : null;

    return res.json({ status: "success", count: items.length, nextCursor, items });
  } catch (err) {
    console.error("GET /api/notifications error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * GET /api/notifications/unread-count
 */
router.get("/unread-count", auth, async (req, res) => {
  try {
    const me = req.user?._id;
    if (!me) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const count = await Notification.countDocuments({ userId: me, isRead: false });
    return res.json({ status: "success", count });
  } catch (err) {
    console.error("GET /api/notifications/unread-count error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/notifications/:id/read
 */
router.patch("/:id/read", auth, async (req, res) => {
  try {
    const me = req.user?._id;
    if (!me) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: "error", message: "Invalid notification ID" });
    }

    const doc = await Notification.findOneAndUpdate(
      { _id: id, userId: me },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    )
      .populate("actorId", "username displayName avatar")
      .lean()
      .exec();

    if (!doc) return res.status(404).json({ status: "error", message: "Notification not found" });

    return res.json({ status: "success", item: doc });
  } catch (err) {
    console.error("PATCH /api/notifications/:id/read error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/notifications/read-all
 */
router.patch("/read-all", auth, async (req, res) => {
  try {
    const me = req.user?._id;
    if (!me) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const result = await Notification.updateMany(
      { userId: me, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.json({ status: "success", modified: result.modifiedCount || 0 });
  } catch (err) {
    console.error("PATCH /api/notifications/read-all error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * DELETE /api/notifications/:id
 * - se isPersistent=true (token/pagamenti) NON cancelliamo (per policy)
 */
router.delete("/:id", auth, async (req, res) => {
  try {
    const me = req.user?._id;
    if (!me) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: "error", message: "Invalid notification ID" });
    }

    const n = await Notification.findOne({ _id: id, userId: me }).lean();
    if (!n) return res.status(404).json({ status: "error", message: "Notification not found" });

    if (n.isPersistent) {
      return res.status(403).json({ status: "error", message: "This notification is not deletable (payment history)" });
    }

    await Notification.deleteOne({ _id: id, userId: me });
    return res.json({ status: "success", deleted: true });
  } catch (err) {
    console.error("DELETE /api/notifications/:id error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
