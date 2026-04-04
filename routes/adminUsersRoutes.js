const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const User = require("../models/user");
const AccountTrustRecord = require("../models/AccountTrustRecord");
const Report = require("../models/Report");
const Post = require("../models/Post");
const ProhibitedSearchLog = require("../models/ProhibitedSearchLog");
const AgeGateLog = require("../models/ageGateLog");
const authMiddleware = require("../middleware/authMiddleware");
const AdminAuditLog = require("../models/AdminAuditLog");

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).trim();
  return req.ip || null;
}

async function adminEnforcementLog(req, targetUserId, decision, reason, before = null, after = null) {
  try {
    if (!req.user?._id) return;
    await AdminAuditLog.create({
      adminId: req.user._id,
      actionType: "ADMIN_USER_ENFORCEMENT",
      targetType: "user",
      targetId: String(targetUserId),
      meta: {
        decision: decision || null,
        reason: reason || null,

        before: {
          isBanned: before?.isBanned ?? null,
          isSuspended: before?.isSuspended ?? null,
          suspendedUntil: before?.suspendedUntil ?? null,
        },

        after: {
          isBanned: after?.isBanned ?? null,
          isSuspended: after?.isSuspended ?? null,
          suspendedUntil: after?.suspendedUntil ?? null,
        },

        ip: getClientIp(req),
        userAgent: (req.headers["user-agent"] || "").toString().slice(0, 500) || null,
      },
    });
  } catch (e) {
    console.error("AdminAuditLog write failed:", e?.message || e);
  }
}

function diffDaysFloor(from, to = new Date()) {
  const ms = Math.max(0, to.getTime() - from.getTime());
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

router.get("/users/:userId/overview", auth, adminGuard, async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    if (!userId) return res.status(400).json({ status: "error", message: "userId required" });

    const user = await User.findById(userId)
      .select("email displayName avatar accountType isVip isCreator isPrivate creatorEnabled creatorDisabledReason creatorDisabledAt verifiedUser verificationStatus verificationTotemStatus adultConsentAt createdAt")
      .lean();

    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    const [trust, reportsPending, reportsRecent, hiddenPosts, prohibitedSearches] = await Promise.all([
      AccountTrustRecord.findOne({ userId }).lean(),
      Report.find({ targetType: "user", targetId: userId, status: "pending" })
        .sort({ createdAt: -1 }).limit(50).lean(),
      Report.find({ $or: [{ targetType: "user", targetId: userId }, { targetOwnerId: userId }] })
        .sort({ createdAt: -1 }).limit(50).lean(),
      Post.find({ authorId: userId, "moderation.status": "hidden" })
        .setOptions({ includeHidden: true })
        .sort({ "moderation.hiddenAt": -1 }).limit(50).lean(),
      ProhibitedSearchLog.find({ userId }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);

    return res.json({
      status: "ok",
      user,
      trust: trust || null,
      reports: { pending: reportsPending, recent: reportsRecent },
      hiddenPosts,
      prohibitedSearches,
    });
  } catch (err) {
    console.error("Admin user overview error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

router.patch("/users/:userId/creator-toggle", auth, adminGuard, async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    const enabled = req.body?.enabled === true;
    const reason = req.body?.reason ? String(req.body.reason).trim() : null;

    const existing = await User.findById(userId)
      .select("_id creatorEnabled creatorDisabledReason creatorDisabledAt isBanned isSuspended suspendedUntil")
      .lean();

    if (!existing) return res.status(404).json({ status: "error", message: "User not found" });

    const before = {
      isBanned: existing?.isBanned ?? null,
      isSuspended: existing?.isSuspended ?? null,
      suspendedUntil: existing?.suspendedUntil ?? null,
    };

    const updated = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          creatorEnabled: enabled,
          creatorDisabledReason: enabled ? null : (reason || "disabled_by_admin"),
          creatorDisabledAt: enabled ? null : new Date(),
        },
      },
      { new: true }
    ).select("displayName isCreator creatorEnabled creatorDisabledReason creatorDisabledAt isBanned isSuspended suspendedUntil")

    const after = {
      isBanned: updated?.isBanned ?? null,
      isSuspended: updated?.isSuspended ?? null,
      suspendedUntil: updated?.suspendedUntil ?? null,
    };

    if (!updated) return res.status(404).json({ status: "error", message: "User not found" });

    await adminEnforcementLog(
      req,
      userId,
      enabled ? "creator_enabled" : "creator_disabled",
      enabled ? null : (reason || "disabled_by_admin"),
      before,
      after
    );

    return res.json({ status: "ok", user: updated });
  } catch (err) {
    console.error("Admin creator toggle error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

router.patch("/users/:userId/vip", auth, adminGuard, async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    const isVip = req.body?.isVip === true;

    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: { isVip } },
      { new: true }
    ).select("displayName isVip");

    if (!updated) return res.status(404).json({ status: "error", message: "User not found" });

    return res.json({ status: "ok", user: updated });
  } catch (err) {
    console.error("Admin vip update error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

router.patch("/users/:userId/privacy", auth, adminGuard, async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    const isPrivate = req.body?.isPrivate === true;

    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: { isPrivate } },
      { new: true }
    ).select("displayName isPrivate");

    if (!updated) return res.status(404).json({ status: "error", message: "User not found" });

    return res.json({ status: "ok", user: updated });
  } catch (err) {
    console.error("Admin privacy update error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/users/:userId/ban
 * Body: { banned: true|false, reason?: string }
 */
router.patch("/users/:userId/ban", auth, adminGuard, async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    const banned = req.body?.banned === true;
    const reason = req.body?.reason ? String(req.body.reason).trim() : null;

    const existing = await User.findById(userId)
      .select("_id isBanned isSuspended suspendedUntil")
      .lean();

    if (!existing) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const before = {
      isBanned: existing?.isBanned ?? null,
      isSuspended: existing?.isSuspended ?? null,
      suspendedUntil: existing?.suspendedUntil ?? null,
    };

    const patch = banned
      ? {
          isBanned: true,
          bannedAt: new Date(),
          banReason: reason || "banned_by_admin",
          bannedByAdminId: req.user._id,
        }
      : {
          isBanned: false,
          bannedAt: null,
          banReason: null,
          bannedByAdminId: null,
        };

    const updated = await User.findByIdAndUpdate(userId, { $set: patch }, { new: true })
      .select("displayName isBanned bannedAt banReason bannedByAdminId accountType isSuspended suspendedUntil")
      .lean();

    if (!updated) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const after = {
      isBanned: updated?.isBanned ?? null,
      isSuspended: updated?.isSuspended ?? null,
      suspendedUntil: updated?.suspendedUntil ?? null,
    };

    await adminEnforcementLog(
      req,
      userId,
      banned ? "ban" : "unban",
      banned ? (reason || "banned_by_admin") : null,
      before,
      after
    );

    return res.json({ status: "ok", user: updated });
  } catch (err) {
    console.error("Admin ban toggle error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * GET /api/admin/users/blocked
 * Returns users that are:
 * - banned (isBanned === true)
 * - OR suspended (isSuspended === true AND suspendedUntil > now)
 * Additionally: includes "suspended with no until" (isSuspended === true && suspendedUntil == null)
 * to allow admin cleanup.
 */
router.get("/users/blocked", auth, adminGuard, async (req, res) => {
  try {
    const now = new Date();

    const blockedUsers = await User.find({
      $or: [
        { isBanned: true },
        { isSuspended: true, suspendedUntil: { $gt: now } },
        { isSuspended: true, suspendedUntil: null }, // cleanup legacy / inconsistent data
      ],
    })
      .select("displayName avatar accountType isVip isCreator isPrivate isBanned bannedAt banReason isSuspended suspendedUntil suspendReason createdAt")
      .sort({ isBanned: -1, suspendedUntil: 1, createdAt: -1 })
      .lean();

    return res.json({ status: "ok", users: blockedUsers });
  } catch (err) {
    console.error("Admin blocked users list error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/users/:userId/unban
 * Body: optional { reason?: string } (not required)
 */
router.patch("/users/:userId/unban", auth, adminGuard, async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    if (!userId) return res.status(400).json({ status: "error", message: "userId required" });

    const existing = await User.findById(userId)
      .select("_id isBanned isSuspended suspendedUntil")
      .lean();

    if (!existing) return res.status(404).json({ status: "error", message: "User not found" });

    const before = {
      isBanned: existing?.isBanned ?? null,
      isSuspended: existing?.isSuspended ?? null,
      suspendedUntil: existing?.suspendedUntil ?? null,
    };

    const updated = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          isBanned: false,
          bannedAt: null,
          banReason: null,
          bannedByAdminId: null,
        },
      },
      { new: true }
    )
      .select("displayName isBanned bannedAt banReason bannedByAdminId isSuspended suspendedUntil")
      .lean();

    if (!updated) return res.status(404).json({ status: "error", message: "User not found" });

    const after = {
      isBanned: updated?.isBanned ?? null,
      isSuspended: updated?.isSuspended ?? null,
      suspendedUntil: updated?.suspendedUntil ?? null,
    };

    await adminEnforcementLog(
      req,
      userId,
      "unban",
      req.body?.reason ? String(req.body.reason).trim() : null,
      before,
      after
    );

    return res.json({ status: "ok", user: updated });
  } catch (err) {
    console.error("Admin unban error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/users/:userId/unsuspend
 */
router.patch("/users/:userId/unsuspend", auth, adminGuard, async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    if (!userId) return res.status(400).json({ status: "error", message: "userId required" });

    const existing = await User.findById(userId)
      .select("_id isBanned isSuspended suspendedUntil")
      .lean();

    if (!existing) return res.status(404).json({ status: "error", message: "User not found" });

    const before = {
      isBanned: existing?.isBanned ?? null,
      isSuspended: existing?.isSuspended ?? null,
      suspendedUntil: existing?.suspendedUntil ?? null,
    };

    const updated = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          isSuspended: false,
          suspendedUntil: null,
          suspendReason: null,
          suspendedByAdminId: null,
        },
      },
      { new: true }
    )
      .select("displayName isBanned isSuspended suspendedUntil suspendReason suspendedByAdminId")
      .lean();

    if (!updated) return res.status(404).json({ status: "error", message: "User not found" });

    const after = {
      isBanned: updated?.isBanned ?? null,
      isSuspended: updated?.isSuspended ?? null,
      suspendedUntil: updated?.suspendedUntil ?? null,
    };

    await adminEnforcementLog(
      req,
      userId,
      "unsuspend",
      req.body?.reason ? String(req.body.reason).trim() : null,
      before,
      after
    );

    return res.json({ status: "ok", user: updated });
  } catch (err) {
    console.error("Admin unsuspend error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * GET /api/admin/growth/summary
 * Phase 1B: lightweight growth stats (no analytics heavy)
 */
router.get("/growth/summary", auth, adminGuard, async (req, res) => {
  try {
    const now = new Date();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Users
    const totalUsersPromise = User.countDocuments({});
    const newUsers7dPromise = User.countDocuments({ createdAt: { $gte: since7d } });

    const latestUsersPromise = User.find({})
      .select("displayName createdAt accountType isCreator creatorEligible payoutProvider payoutAccountId payoutStatus")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // Activation (7d)
    const emailVerified7dPromise = User.countDocuments({ emailVerifiedAt: { $gte: since7d } });
    const adultConsent7dPromise = User.countDocuments({ adultConsentAt: { $gte: since7d } });

    // Creators
    const totalCreatorsPromise = User.countDocuments({ isCreator: true });

    // "requested but not approved"
    const creatorRequestedPendingPromise = User.countDocuments({
      isCreator: false,
      $and: [
        { $or: [{ creatorEligible: false }, { creatorEligible: { $exists: false } }] },
        {
          $or: [
            { payoutProvider: "stripe" },
            { payoutAccountId: { $ne: null } },
            { payoutStatus: "pending" },
          ],
        },
      ],
    });

    const creatorEligiblePromise = User.countDocuments({ creatorEligible: true });

    const [
      totalUsers,
      newUsers7d,
      latestUsers,
      emailVerified7d,
      adultConsent7d,
      totalCreators,
      creatorRequestedPending,
      creatorEligible,
    ] = await Promise.all([
      totalUsersPromise,
      newUsers7dPromise,
      latestUsersPromise,
      emailVerified7dPromise,
      adultConsent7dPromise,
      totalCreatorsPromise,
      creatorRequestedPendingPromise,
      creatorEligiblePromise,
    ]);

    return res.json({
      status: "ok",
      users: {
        total: totalUsers,
        new7d: newUsers7d,
        latest: latestUsers.map((u) => ({
          _id: u._id,
          displayName: u.displayName,
          createdAt: u.createdAt,
          accountType: u.accountType,
        })),
      },
      activation: {
        emailVerified7d,
        adultConsent7d,
      },
      creators: {
        total: totalCreators,
        requestedPendingApproval: creatorRequestedPending,
        eligible: creatorEligible,
      },
      meta: {
        since7d,
        now,
      },
    });
  } catch (err) {
    console.error("Admin growth summary error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

router.get("/age-gate/logs", authMiddleware, adminGuard, async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim().toLowerCase();
    const minAttemptsRaw = Number(req.query.minAttempts);
    const minAttempts = Number.isFinite(minAttemptsRaw) ? Math.max(0, Math.floor(minAttemptsRaw)) : 2;

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50;

    const sort = (req.query.sort || "newest").toString();

    const filter = { failedUnderageAttempts: { $gte: minAttempts } };

    if (q) {
      filter.email = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }

    let sortObj = { lastUnderageAttemptAt: -1 };
    if (sort === "oldest") sortObj = { lastUnderageAttemptAt: 1 };
    if (sort === "mostAttempts") sortObj = { failedUnderageAttempts: -1, lastUnderageAttemptAt: -1 };

    const [logs, total] = await Promise.all([
      AgeGateLog.find(filter).sort(sortObj).limit(limit).lean(),
      AgeGateLog.countDocuments(filter),
    ]);

    return res.json({ status: "ok", logs, total });
  } catch (err) {
    console.error("ADMIN /age-gate/logs error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

router.get("/deleted-users", auth, adminGuard, async (req, res) => {
  try {
    const users = await User.find({
      isDeleted: true,
    })
      .select("_id displayName deletedAt")
      .sort({ deletedAt: 1 })
      .lean();

    const now = new Date();

    const rows = users.map((u) => {
      const daysPassed = u.deletedAt ? diffDaysFloor(new Date(u.deletedAt), now) : 0;
      const daysLeft = 30 - daysPassed;
      return {
        userId: u._id,
        displayName: u.displayName,
        deletedAt: u.deletedAt,
        daysLeft,
        readyToPurge: daysLeft <= 0,
      };
    });

    return res.json({ status: "ok", users: rows });
  } catch (err) {
    console.error("ADMIN /deleted-users error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

router.delete("/users/:id/purge", auth, adminGuard, async (req, res) => {
  try {
    const targetUserId = String(req.params.id || "").trim();
    if (!targetUserId) return res.status(400).json({ status: "error", message: "Invalid user ID" });

    const user = await User.findById(targetUserId).select("_id displayName isDeleted deletedAt isBanned isSuspended suspendedUntil").lean();
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    if (!user.isDeleted || !user.deletedAt) {
      return res.status(400).json({ status: "error", message: "User not in deletion state" });
    }

    const daysPassed = diffDaysFloor(new Date(user.deletedAt), new Date());
    const daysLeft = 30 - daysPassed;
    if (daysLeft > 0) {
      return res.status(403).json({ status: "error", message: "Not ready to purge yet", daysLeft });
    }

    await Promise.allSettled([
      Post.deleteMany({ authorId: targetUserId }),
      Report.deleteMany({ $or: [{ targetId: targetUserId }, { targetOwnerId: targetUserId }] }),
      AccountTrustRecord.deleteMany({ userId: targetUserId }),
      ProhibitedSearchLog.deleteMany({ userId: targetUserId }),
      AgeGateLog.deleteMany({ userId: targetUserId }),

      User.updateMany({ followingIds: targetUserId }, { $pull: { followingIds: targetUserId } }),
      User.updateMany({ blockedUsers: targetUserId }, { $pull: { blockedUsers: targetUserId } }),
    ]);

    const before = {
      isBanned: user?.isBanned ?? null,
      isSuspended: user?.isSuspended ?? null,
      suspendedUntil: user?.suspendedUntil ?? null,
    };

    await User.deleteOne({ _id: targetUserId });

    await adminEnforcementLog(
      req,
      targetUserId,
      "purge",
      "gdpr_purge_hard",
      before,
      null
    );

    return res.json({ status: "ok" });
  } catch (err) {
    console.error("ADMIN purge user error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
