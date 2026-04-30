// routes/profileEventBannerRoutes.js
const mongoose = require("mongoose");
const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const Event = require("../models/event");
const User = require("../models/user");
const Follow = require("../models/Follow");
const { isUserBlockedEitherSide } = require("../utils/blockUtils");

// GET /api/profile/event-banner/:userId
// Banner evento sul profilo (derivato da Event, NON da Adv)
router.get("/event-banner/:userId", auth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.json({ status: "ok", data: null });
    }
    const targetUserId = new mongoose.Types.ObjectId(String(userId));

    // 🔒 BLOCK GUARD
    const meId = req.user?._id?.toString();
    if (meId) {
      const blocked = await isUserBlockedEitherSide(meId, String(userId));
      if (blocked) {
        return res.status(200).json({ status: "ok", data: null });
      }
    }

    // ✅ PRIVACY GUARD: banner visibile solo a owner o follower accepted se profilo privato
    const targetUser = await User.findById(userId).select("_id isPrivate").lean();
    if (!targetUser) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const isOwner = meId && meId === String(targetUser._id);
    const isAdmin = String(req.user?.accountType || "").toLowerCase() === "admin";

    if (targetUser.isPrivate === true && !isOwner && !isAdmin) {
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

    const now = Date.now();

    const totalByCreator = await Event.countDocuments({ creatorId: targetUserId });

    const totalScheduledLive = await Event.countDocuments({
      creatorId: targetUserId,
      status: { $in: ["scheduled", "live"] },
    });

    // prendiamo eventi "candidati" dell'utente:
    // scheduled + live (finished/cancelled NON ci servono per mostrarlo)

    const candidates = await Event.find({
      creatorId: targetUserId,
      status: { $in: ["scheduled", "live"] },
    })
      .sort({ plannedStartTime: 1, startTime: 1 })
      .populate("creatorId", "displayName username avatar avatarUrl")
      .lean();

    if (!candidates || candidates.length === 0) {
      return res.json({ status: "ok", data: null });
    }

    // Funzione visibilità
    const isVisible = (ev) => {
      try {
        if (!ev || !ev.status) return false;

        const st = String(ev.status);

        // mai visibile dopo chiusura
        if (st === "finished" || st === "cancelled") return false;

        // LIVE: visibile sempre finché resta live
        if (st === "live") return true;

        // SCHEDULED: visibile da 48h prima dello start, e resta visibile anche dopo lo start
        // finché lo status rimane scheduled (durata ignorata)
        if (st === "scheduled") {
          const startVal = ev.plannedStartTime || ev.startTime;
          const startMs = startVal ? new Date(startVal).getTime() : NaN;
          if (Number.isNaN(startMs)) return false;

          const leadMs = 48 * 3600 * 1000;
          return now >= (startMs - leadMs);
        }

        // altri status: non visibile
        return false;
      } catch (e) {
        console.log("[BANNER][VIS] exception", String(ev?._id), e);
        return false;
      }
    };

    // scegliamo il primo evento visibile (più imminente)
    const best = candidates.find(isVisible);

    if (!best) {
      return res.json({ status: "ok", data: null });
    }

    // costruzione oggetto banner (minimo indispensabile)
    const banner = {
      eventId: best._id,
      status: best.status,
      startTime: best.startTime || null,
      plannedStartTime: best.plannedStartTime || null,
      title: best.title || null,
      contentScope: best.contentScope || null,          // 👈 ADD
      ticketPriceTokens: best.ticketPriceTokens ?? 0, 
      description: best.description || null,   // ✅ ADD
      coverUrl: best.coverUrl || null,
      creatorAvatarUrl: best?.creatorId?.avatarUrl || best?.creatorId?.avatar || null,
      creatorDisplayName: best?.creatorId?.displayName || best?.creatorId?.username || null,
      targetUrl: `/live/event/${best._id}`,
    };

    return res.json({ status: "ok", data: banner });
  } catch (err) {
    console.error("Profile event banner error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
