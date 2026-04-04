// routes/oldLiveRoutes.js
const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const Event = require("../models/event");
const LiveRoom = require("../models/LiveRoom");
const User = require("../models/user");
const Follow = require("../models/Follow");
const { isUserBlockedEitherSide } = require("../utils/blockUtils");

/**
 * OLD-LIVE (profilo utente)
 * - solo live concluse
 * - max 10
 * - ordinamento per performance reale: peakViewers / durataMin
 *
 * GET /api/profile/old-live/:userId
 */
router.get("/old-live/:userId", auth, async (req, res) => {
  try {
    const { userId } = req.params;

    // 🔒 BLOCK GUARD
    const meId = req.user?._id?.toString();
    if (meId) {
      const blocked = await isUserBlockedEitherSide(meId, String(userId));
      if (blocked) {
        return res.status(403).json({
          status: "error",
          message: "Content unavailable",
        });
      }
    }

    // ✅ PRIVACY GUARD: old-live visibile solo a owner o follower accepted se profilo privato
    const targetUser = await User.findById(userId).select("_id isPrivate accountType").lean();
    if (!targetUser) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }
    if (targetUser.accountType === "admin") {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    const isOwner = meId && meId === String(targetUser._id);

    if (targetUser.isPrivate === true && !isOwner) {
      const canSee = await Follow.findOne({
        followerId: req.user._id,
        followingId: targetUser._id,
        status: "accepted",
      })
        .select("_id")
        .lean();

      if (!canSee) {
        return res.status(403).json({
          status: "error",
          code: "PROFILE_PRIVATE",
          message: "Private profile",
        });
      }
    }

    // 1️⃣ Eventi conclusi dell’utente
    const events = await Event.find({
      creatorId: userId,
      status: "finished",
    })
      .select(
        "_id title coverImage category language startTime plannedStartTime endedAt live.startedAt live.endedAt createdAt updatedAt"
      )
      .lean();

    if (!events.length) {
      return res.json({ items: [] });
    }

    const eventIds = events.map((e) => e._id);

    // 2️⃣ Peak viewers (max tra public + private)
    const rooms = await LiveRoom.find({ eventId: { $in: eventIds } })
      .select("eventId peakViewersCount")
      .lean();

    const peakByEvent = new Map();
    for (const r of rooms) {
      const id = r.eventId.toString();
      const prev = peakByEvent.get(id) || 0;
      const peak = Number(r.peakViewersCount || 0);
      if (peak > prev) peakByEvent.set(id, peak);
    }

    // 3️⃣ Helper durata
    function getDurationMinutes(e) {
      const start =
        e?.live?.startedAt ||
        e?.startTime ||
        e?.plannedStartTime ||
        e?.createdAt ||
        null;

      const end =
        e?.live?.endedAt ||
        e?.endedAt ||
        e?.updatedAt ||
        null;

      if (!start || !end) return null;

      const ms = new Date(end).getTime() - new Date(start).getTime();
      if (!Number.isFinite(ms) || ms <= 0) return 1;

      const mins = Math.floor(ms / 60000);
      return mins > 0 ? mins : 1;
    }

    // 4️⃣ Costruzione Old-Live
    const items = events
      .map((e) => {
        const peak = peakByEvent.get(e._id.toString()) || 0;
        const durationMinutes = getDurationMinutes(e);
        const score = durationMinutes ? peak / durationMinutes : peak;

        return {
          eventId: e._id,
          title: e.title,
          coverImage: e.coverImage,
          category: e.category,
          language: e.language,

          startedAt:
          e?.live?.startedAt ||
          e?.startTime ||
          e?.plannedStartTime ||
          e?.createdAt ||
          null,

        endedAt:
          e?.live?.endedAt ||
          e?.endedAt ||
          e?.updatedAt ||
          null,

          peakViewers: peak,
          durationMinutes,
          score,

          cardType: "event",
          isOldLive: true,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    return res.json({ items });
  } catch (err) {
    console.error("OLD-LIVE error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
