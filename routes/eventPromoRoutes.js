const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const Event = require("../models/event");

// helpers
function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(x, max));
}

function isOwnerOrAdmin(reqUser, eventDoc) {
  const uid = String(reqUser.id || reqUser._id);
  const creatorId = String(eventDoc.creatorId || "");
  const role = reqUser.accountType || reqUser.role || "base";
  return uid === creatorId || role === "admin";
}

/**
 * POST /api/events/:eventId/profile-promo/publish
 * body (opzionale):
 * - publishedAt: ISO date (se non c’è -> now)
 * - leadHours: number (0..48)
 */
router.post("/:eventId/profile-promo/publish", auth, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { publishedAt, leadHours } = req.body || {};

    const ev = await Event.findById(eventId);
    if (!ev) return res.status(404).json({ status: "error", message: "Event not found" });

    if (!isOwnerOrAdmin(req.user, ev)) {
      return res.status(403).json({ status: "error", message: "Not allowed" });
    }

    // non ha senso promuovere un evento già finito/cancellato
    if (ev.status === "finished" || ev.status === "cancelled") {
      return res.status(400).json({
        status: "error",
        message: "Cannot promote finished/cancelled event",
      });
    }

    ev.profilePromoEnabled = true;

    // publishedAt = ora (default) o data passata dal FE
    const p = publishedAt ? new Date(publishedAt) : new Date();
    if (publishedAt && Number.isNaN(p.getTime())) {
      return res.status(400).json({ status: "error", message: "publishedAt invalid" });
    }
    ev.profilePromoPublishedAt = p;

    // leadHours opzionale
    if (leadHours !== undefined) {
      ev.profilePromoLeadHours = clamp(leadHours, 0, 48);
    }

    await ev.save();

    return res.json({
      status: "ok",
      data: {
        eventId: ev._id,
        profilePromoEnabled: ev.profilePromoEnabled,
        profilePromoPublishedAt: ev.profilePromoPublishedAt,
        profilePromoLeadHours: ev.profilePromoLeadHours,
      },
    });
  } catch (err) {
    console.error("publish promo error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * POST /api/events/:eventId/profile-promo/unpublish
 */
router.post("/:eventId/profile-promo/unpublish", auth, async (req, res) => {
  try {
    const { eventId } = req.params;

    const ev = await Event.findById(eventId);
    if (!ev) return res.status(404).json({ status: "error", message: "Event not found" });

    if (!isOwnerOrAdmin(req.user, ev)) {
      return res.status(403).json({ status: "error", message: "Not allowed" });
    }

    ev.profilePromoEnabled = false;
    ev.profilePromoPublishedAt = null;

    await ev.save();

    return res.json({
      status: "ok",
      data: {
        eventId: ev._id,
        profilePromoEnabled: ev.profilePromoEnabled,
        profilePromoPublishedAt: ev.profilePromoPublishedAt,
      },
    });
  } catch (err) {
    console.error("unpublish promo error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
