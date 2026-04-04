// routes/followRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const User = require("../models/user");
const Follow = require("../models/Follow");
const Notification = require("../models/notification");

/**
 * @route   POST /api/follow/:id
 * @desc    Segui un utente (pending se target privato, accepted se pubblico)
 * @access  Private
 */
router.post("/:id", auth, async (req, res) => {
  try {
    const me = req.user?._id;
    if (!me) {
      return res.status(401).json({ status: "error", message: "Unauthenticated user" });
    }

    const targetUserId = req.params.id;
    if (!targetUserId || targetUserId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid user ID" });
    }

    // Non puoi seguire te stesso (prima di tutto)
    if (me.toString() === targetUserId.toString()) {
      return res.status(400).json({ status: "error", message: "You can't follow yourself" });
    }

    // Carico target con isPrivate
    const target = await User.findById(targetUserId).select("_id isPrivate username displayName avatar accountType").lean();
    if (!target) {
      return res.status(404).json({ status: "error", message: "User to follow not found" });
    }

    const newStatus = target.isPrivate ? "pending" : "accepted";

    // --- NOTIFICA (best-effort) ---
    try {
      if (newStatus === "pending") {
        // notifica al target: richiesta follow
        await Notification.create({
          userId: target._id,
          actorId: me,
          type: "SOCIAL_FOLLOW_REQUEST",
          targetType: "user",
          targetId: me,
          message: "New follow request",
          dedupeKey: `follow_request:${me.toString()}:${target._id.toString()}`,
        });
      } else {
        // notifica al target: nuovo follower
        await Notification.create({
          userId: target._id,
          actorId: me,
          type: "SOCIAL_NEW_FOLLOWER",
          targetType: "user",
          targetId: me,
          message: "You have a new follower",
          dedupeKey: `new_follower:${me.toString()}:${target._id.toString()}`,
        });
      }
    } catch (e) {
      // dedupeKey può già esistere -> ignora
    }

    const existing = await Follow.findOne({ followerId: me, followingId: target._id }).lean();
    if (existing) {
      // se è già pending o accepted, non rifare nulla
      return res.status(200).json({
        status: "success",
        message: existing.status === "accepted" ? "Follow already active" : "Request already sent (pending)",
        data: {
          followerId: me,
          followingId: target._id,
          followStatus: existing.status,
          acceptedAt: existing.acceptedAt ?? null,
        },
      });
    }

    const doc = await Follow.findOneAndUpdate(
      { followerId: me, followingId: target._id },
      {
        $setOnInsert: {
          followerId: me,
          followingId: target._id,
          requestedAt: new Date(),
        },
        $set: {
          status: newStatus,
          acceptedAt: newStatus === "accepted" ? new Date() : null,
        },
      },
      { upsert: true, new: true }
    ).lean();

    console.log("FOLLOW_CREATE_DEBUG", {
      me: me.toString(),
      target: target._id.toString(),
      targetIsPrivate: target.isPrivate,
      savedStatus: doc?.status,
    });

    return res.status(200).json({
      status: "success",
      message: newStatus === "accepted" ? "Follow accepted" : "Request sent (waiting for approval)",
      data: {
        followerId: me,
        followingId: target._id,
        followStatus: doc.status,
        acceptedAt: doc.acceptedAt ?? null,
      },
    });
  } catch (err) {
    console.error("Errore durante follow utente:", err);
    return res.status(500).json({ status: "error", message: "Internal error during follow operation" });
  }
});

/**
 * @route   POST /api/follow/requests/:followerId/accept
 * @desc    Accetta che utente ti segua
 * @access  Private
 */
router.post("/request/:followerId/accept", auth, async (req, res) => {
  try {
    const user = req.user; // chi accetta (target)
    if (!user) return res.status(401).json({ status: "error", message: "Unauthenticated user" });

    const me = user._id;

    // ✅ DEFINIZIONE CHE TI MANCA
    const followerIdFromParams = req.params.followerId;
    if (!followerIdFromParams || followerIdFromParams.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid followerId" });
    }

    const followerId = new mongoose.Types.ObjectId(followerIdFromParams);

    console.log("FOLLOW_ACCEPT_DEBUG", {
      me: me.toString(),
      followerIdFromParams: followerIdFromParams.toString(),
    });

    const doc = await Follow.findOneAndUpdate(
      { followerId, followingId: me, status: "pending" },
      { $set: { status: "accepted", acceptedAt: new Date() } },
      { new: true }
    ).exec();

    const existing = await Follow.findOne({
      followerId: followerIdFromParams,
      followingId: me,
    }).lean();

console.log("FOLLOW_ACCEPT_CHECK", existing);

    if (!doc) {
      return res.status(404).json({ status: "error", message: "Pending follow request not found" });
    }

    // --- NOTIFICA (best-effort) ---
    try {
      await Notification.create({
        userId: followerIdFromParams,
        actorId: me,
        type: "SOCIAL_FOLLOW_ACCEPTED",
        targetType: "user",
        targetId: me,
        message: "Your follow request has been accepted",
        dedupeKey: `follow_accepted:${followerIdFromParams.toString()}:${me.toString()}`,
      });
    } catch (e) {}

    return res.status(200).json({
      status: "success",
      message: "Follow request accepted",
      data: { followId: doc._id, status: doc.status, acceptedAt: doc.acceptedAt },
    });
  } catch (err) {
    console.error("Errore accept follow:", err);
    return res.status(500).json({ status: "error", message: "Internal error accept follow" });
  }
});

/**
 * @route   DELETE /api/follow/:id
 * @desc    Smetti di seguire un utente
 * @access  Private
 */
router.delete("/:id", auth, async (req, res) => {
  try {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthenticated user",
      });
    }

    const targetUserId = req.params.id;

    if (!targetUserId || targetUserId.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID",
      });
    }

    const result = await Follow.findOneAndDelete({
      followerId: user._id,
      followingId: targetUserId,
    }).exec();

    if (!result) {
      // Non lo seguiva già, ma non è un errore grave
      return res.status(200).json({
        status: "success",
        message: "You were not following this user",
        data: {
          unfollowed: false,
        },
      });
    }

    return res.status(200).json({
      status: "success",
      message: "You have stopped following this user",
      data: {
        unfollowed: true,
      },
    });
  } catch (err) {
    console.error("Errore durante unfollow utente:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during unfollow operation",
    });
  }
});

/**
 * @route   GET /api/follow/:id/followers
 * @desc    Lista follower di un utente (solo accepted). Se profilo privato: solo owner o follower accepted.
 * @access  Private
 */
router.get("/:id/followers", auth, async (req, res) => {
  try {
    const me = req.user?._id;
    if (!me) {
      return res.status(401).json({ status: "error", message: "Unauthenticated user" });
    }

    const targetUserId = req.params.id;
    if (!targetUserId || targetUserId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid user ID" });
    }

    const target = await User.findById(targetUserId).select("_id isPrivate").lean();
    if (!target) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    // Privacy guard
    if (target.isPrivate === true && target._id.toString() !== me.toString()) {
      const canSee = await Follow.findOne({
        followerId: me,
        followingId: target._id,
        status: "accepted",
      }).lean();

      if (!canSee) {
        return res.status(403).json({
          status: "error",
          code: "PROFILE_PRIVATE",
          message: "Private profile: you cannot see the follower list",
        });
      }
    }

    // Solo accepted (non esporre pending)
    const follows = await Follow.find({ followingId: targetUserId, status: "accepted" })
      .select("followerId acceptedAt createdAt")
      .lean();

    const followerIds = follows.map((f) => f.followerId);

    const users = await User.find({ _id: { $in: followerIds } })
      .select("_id username displayName avatar accountType")
      .lean();

    return res.status(200).json({
      status: "success",
      message: "Follower list successfully recovered",
      data: {
        count: users.length,
        users,
      },
    });
  } catch (err) {
    console.error("Errore durante get followers:", err);
    return res.status(500).json({ status: "error", message: "Internal error during follower list recovery" });
  }
});

/**
 * @route   GET /api/follow/:id/following
 * @desc    Lista utenti seguiti da un utente
 * @access  Private
 */
router.get("/:id/following", auth, async (req, res) => {
  try {
    const targetUserId = req.params.id;

    if (!targetUserId || targetUserId.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID",
      });
    }

    const follows = await Follow.find({ followerId: targetUserId, status: "accepted" })
      .select("followingId createdAt")
      .lean()
      .exec();

    const followingIds = follows.map((f) => f.followingId);

    const users = await User.find({ _id: { $in: followingIds } })
      .select("_id username displayName avatar accountType")
      .lean()
      .exec();

    return res.status(200).json({
      status: "success",
      message: "Following list successfully recovered",
      data: {
        count: users.length,
        users,
      },
    });
  } catch (err) {
    console.error("Errore durante get following:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during following list recovery",
    });
  }
});

/**
 * @route   GET /api/follow/relationship/:id
 * @desc    Stato relazione tra me e target (per bottone stile X)
 * @access  Private
 */
router.get("/relationship/:id", auth, async (req, res) => {
  try {
    const me = req.user?._id;
    if (!me) {
      return res.status(401).json({ status: "error", message: "Unauthenticated user" });
    }

    const targetUserId = req.params.id;
    if (!targetUserId || targetUserId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid user ID" });
    }

    // Non ha senso chiedere relazione con sé stessi (ma non è un errore grave)
    if (me.toString() === targetUserId.toString()) {
      return res.status(200).json({
        status: "success",
        data: {
          targetUserId,
          iFollow: false,
          followsMe: false,
          followStatus: "self",
        },
      });
    }

    // io -> target
    const out = await Follow.findOne({
      followerId: me,
      followingId: targetUserId,
    })
      .select("status requestedAt acceptedAt createdAt updatedAt")
      .lean();

    // target -> io
    const incoming = await Follow.findOne({
      followerId: targetUserId,
      followingId: me,
    })
      .select("status")
      .lean();

    return res.status(200).json({
      status: "success",
      data: {
        targetUserId,
        iFollow: !!out && out.status === "accepted",
        iRequested: !!out && out.status === "pending",
        followStatus: out?.status || "none", // none | pending | accepted
        followsMe: !!incoming && incoming.status === "accepted",
        meta: out
          ? {
              requestedAt: out.requestedAt || null,
              acceptedAt: out.acceptedAt || null,
              createdAt: out.createdAt || null,
              updatedAt: out.updatedAt || null,
            }
          : null,
      },
    });
  } catch (err) {
    console.error("Errore relationship:", err);
    return res.status(500).json({ status: "error", message: "Internal error relationship" });
  }
});

/**
 * @route   DELETE /api/follow/request/:id/cancel
 * @desc    Annulla una richiesta di follow pending (stile X: "Annulla richiesta")
 * @access  Private
 */
router.delete("/request/:id/cancel", auth, async (req, res) => {
  try {
    const me = req.user?._id;
    if (!me) {
      return res.status(401).json({ status: "error", message: "Unauthenticated user" });
    }

    const targetUserId = req.params.id;
    if (!targetUserId || targetUserId.length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid user ID" });
    }

    // cancella SOLO se è pending e l'ho creata io
    const deleted = await Follow.findOneAndDelete({
      followerId: me,
      followingId: targetUserId,
      status: "pending",
    }).lean();

    if (!deleted) {
      return res.status(404).json({
        status: "error",
        message: "No pending request to cancel",
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Request cancelled",
      data: {
        followerId: me,
        followingId: targetUserId,
        cancelled: true,
      },
    });
  } catch (err) {
    console.error("Errore cancel request:", err);
    return res.status(500).json({ status: "error", message: "Internal error during request cancellation" });
  }
});


module.exports = router;
