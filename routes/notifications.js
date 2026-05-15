// routes/notifications.js
const express = require("express");
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const Notification = require("../models/notification");
const Follow = require("../models/Follow");
const User = require("../models/user");
const {
  getOppositeEnvironmentUserQuery,
  shouldHideInternalTestUser,
} = require("../utils/internalTestAccounts");
const { shouldHidePublicSocialUser } = require("../utils/publicSocialUser");

const router = express.Router();

function getActorId(notification) {
  const actor = notification?.actorId;
  if (!actor) return null;
  if (typeof actor === "string") return actor;
  return actor?._id || actor?.id || null;
}

async function reconcileFollowRequestNotifications(items, userId) {
  const nextItems = await Promise.all(
    items.map(async (item) => {
      const type = String(item?.type || "").trim().toUpperCase();
      if (type !== "SOCIAL_FOLLOW_REQUEST") return item;

      const data = item?.data || {};
      if (data.followRequestAccepted === true || data.followRequestCancelled === true || data.actionable === false) {
        return item;
      }

      const followerId = getActorId(item);
      if (!followerId) return item;

      const pending = await Follow.exists({
        followerId,
        followingId: userId,
        status: "pending",
      });

      if (pending) return item;

      const now = new Date();
      const patch = {
        message: "Follow request cancelled",
        isRead: true,
        readAt: now,
        data: {
          ...data,
          followRequestCancelled: true,
          followRequestAccepted: false,
          actionable: false,
        },
      };

      await Notification.updateOne(
        { _id: item._id, userId },
        {
          $set: {
            message: patch.message,
            isRead: patch.isRead,
            readAt: patch.readAt,
            data: patch.data,
          },
        }
      );

      return { ...item, ...patch };
    })
  );

  return nextItems;
}

async function getEnvironmentExcludedActorIds(viewerUser) {
  const environmentQuery = getOppositeEnvironmentUserQuery(viewerUser);
  const hiddenConditions = [
    { emailVerifiedAt: null },
    { isBanned: true },
    { isSuspended: true },
    { isDeleted: true },
    { deletedAt: { $ne: null } },
    ...(environmentQuery ? [environmentQuery] : []),
  ];

  const users = await User.find({ $or: hiddenConditions }).select("_id").lean();
  return users.map((u) => u._id);
}

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

    const excludedActorIds = await getEnvironmentExcludedActorIds(req.user);
    const q = { userId: me };
    if (unreadOnly) q.isRead = false;
    if (cursor && !Number.isNaN(cursor.getTime())) q.createdAt = { $lt: cursor };
    if (excludedActorIds.length) {
      q.$or = [
        { actorId: { $exists: false } },
        { actorId: null },
        { actorId: { $nin: excludedActorIds } },
      ];
    }

    const rawItems = await Notification.find(q)
      .sort({ createdAt: -1 })
      .populate("actorId", "username displayName avatar email emailVerifiedAt accountType isInternalTest isBanned isSuspended isDeleted deletedAt")
      .limit(limit)
      .lean();

    const environmentItems = rawItems.filter((item) => {
      if (!item?.actorId || typeof item.actorId !== "object") return true;
      return (
        !shouldHideInternalTestUser(item.actorId, req.user) &&
        !shouldHidePublicSocialUser(item.actorId, req.user)
      );
    });

    const items = await reconcileFollowRequestNotifications(environmentItems, me);

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

    const excludedActorIds = await getEnvironmentExcludedActorIds(req.user);
    const q = { userId: me, isRead: false };
    if (excludedActorIds.length) {
      q.$or = [
        { actorId: { $exists: false } },
        { actorId: null },
        { actorId: { $nin: excludedActorIds } },
      ];
    }

    const unreadFollowRequests = await Notification.find({
      ...q,
      type: "SOCIAL_FOLLOW_REQUEST",
    }).lean();

    await reconcileFollowRequestNotifications(unreadFollowRequests, me);
    const count = await Notification.countDocuments(q);
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
      .populate("actorId", "username displayName avatar email emailVerifiedAt accountType isInternalTest isBanned isSuspended isDeleted deletedAt")
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
