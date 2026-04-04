// routes/admin/adminVerifications.routes.js
const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware"); // <- controlla path/nome esatto
const adminGuard = require("../middleware/adminGuard");

const User = require("../models/user");
const mongoose = require("mongoose");
const Notification = require("../models/notification");

function parseLimit(v, def = 50, min = 1, max = 200) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function parseSkip(v, def = 0) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(0, n);
}

/**
 * GET /api/admin/verifications
 * Query:
 *  - status: None|Pending|Approved|Rejected|all   (default Pending)
 *  - type: profile|totem|all                      (default all)
 *  - q: search displayName (optional)
 *  - limit, skip
 *  - sort: new|old (default new)
 */
router.get("/", auth, adminGuard, async (req, res) => {
  try {
    const status = String(req.query.status || "pending").trim().toLowerCase();
    const type = String(req.query.type || "all").trim().toLowerCase();
    const safeType = ["profile", "totem", "creator", "all"].includes(type) ? type : "all";
    const q = (req.query.q || "").trim();
    const limit = parseLimit(req.query.limit, 50);
    const skip = parseSkip(req.query.skip, 0);
    const sortDir = (req.query.sort || "new").trim() === "old" ? 1 : -1;

    const query = {};

    // status filter
    const allowedStatus = ["none", "pending", "approved", "rejected", "all"];
    const safeStatus = allowedStatus.includes(status) ? status : "pending";

    if (safeType === "profile") {
      query.verificationStatus = safeStatus;
    } else if (safeType === "totem") {
      query.verificationTotemStatus = safeStatus;
    } else if (safeType === "creator") {
      query["creatorVerification.status"] = safeStatus;
    } else {
      query.$or = [
        { verificationStatus: safeStatus },
        { verificationTotemStatus: safeStatus },
        { "creatorVerification.status": safeStatus },
      ];
    }

    // type filter
    if (safeType === "profile") {
      query.verificationStatus = query.verificationStatus || { $ne: "none" };
    } else if (safeType === "totem") {
      query.verificationTotemStatus = query.verificationTotemStatus || { $ne: "none" };
    } else if (safeType === "creator") {
      query["creatorVerification.status"] = query["creatorVerification.status"] || { $ne: "none" };
    } else {
      const baseOr = query.$or ? [...query.$or] : [];
      baseOr.push(
        { verificationStatus: { $ne: "none" } },
        { verificationTotemStatus: { $ne: "none" } },
        { "creatorVerification.status": { $ne: "none" } }
      );
      query.$or = baseOr;
    }

    // search
    if (q) {
      query.displayName = { $regex: q, $options: "i" };
    }

    const projection =
      "displayName avatar coverImage accountType createdAt isCreator creatorEnabled creatorVerification verificationStatus verificationPublicVideoUrl verificationTotemStatus verificationTotemVideoUrl verificationTotemDescription payoutProvider payoutEnabled payoutStatus";

    const [items, total] = await Promise.all([
      User.find(query)
        .select(projection)
        .sort({ createdAt: sortDir })
        .skip(skip)
        .limit(limit),
      User.countDocuments(query),
    ]);

    return res.json({
      status: "ok",
      total,
      limit,
      skip,
      items,
    });
  } catch (err) {
    console.error("Admin verifications list error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/verifications/:userId/profile/approve
 */
router.patch("/:userId/profile/approve", auth, adminGuard, async (req, res) => {
  try {
    const { userId } = req.params;
    const adminNote = (req.body?.note || "").toString().trim() || null;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ status: "error", message: "Invalid user ID" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });
    user.verificationStatus = "approved";
    user.verifiedUser = true;

    await user.save();

    // 🔔 notifica utente
    try {
      await Notification.create({
        userId: user._id,
        actorId: req.user?._id || null,
        type: "SYSTEM_PROFILE_VERIFICATION_APPROVED",
        targetType: "user",
        targetId: user._id,
        message: "Profile verification approved.",
        data: { note: adminNote || "" },
        isPersistent: false,
        dedupeKey: `verif:profile:${user._id}:approved`,
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }

    // 🧹 pulizia pending admin (se presente)
    await Notification.updateMany(
      {
        type: "ADMIN_PROFILE_VERIFICATION_PENDING",
        targetType: "user",
        targetId: user._id,
        dedupeKey: `admin:verify:${user._id}:profile:pending`,
        userId: null,
        isRead: false,
      },
      { $set: { isRead: true, readAt: new Date() } }
    );
    return res.json({ status: "ok" });
  } catch (err) {
    console.error("admin profile approve error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/verifications/:userId/profile/reject
 * body: { reason } (OBBLIGATORIO)
 */
router.patch("/:userId/profile/reject", auth, adminGuard, async (req, res) => {
  try {
    const { userId } = req.params;
    const reason = (req.body?.reason || "").toString().trim();

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ status: "error", message: "Invalid user ID" });
    }
    if (!reason) {
      return res.status(400).json({ status: "error", message: "reason required" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    user.verificationStatus = "rejected";
    user.verifiedUser = false;

    await user.save();

    // 🔔 notifica utente (motivo SOLO qui)
    try {
      await Notification.create({
        userId: user._id,
        actorId: req.user?._id || null,
        type: "SYSTEM_PROFILE_VERIFICATION_REJECTED",
        targetType: "user",
        targetId: user._id,
        message: "Profile verification rejected.",
        data: { reason },
        isPersistent: false,
        dedupeKey: `verif:profile:${user._id}:rejected`,
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }

    // 🧹 pulizia pending admin (se presente)
    await Notification.updateMany(
      {
        type: "ADMIN_TOTEM_VERIFICATION_PENDING",
        targetType: "user",
        targetId: user._id,
        dedupeKey: `admin:verify:${user._id}:totem:pending`,
        userId: null,
        isRead: false,
      },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.json({ status: "ok" });
  } catch (err) {
    console.error("admin profile reject error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/verifications/:userId/totem/approve
 */
router.patch("/:userId/totem/approve", auth, adminGuard, async (req, res) => {
  try {
    const { userId } = req.params;
    const adminNote = (req.body?.note || "").toString().trim() || null;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ status: "error", message: "Invalid user ID" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });
    user.verificationTotemStatus = "approved";
    await user.save();

    // 🔔 notifica utente
    try {
      await Notification.create({
        userId: user._id,
        actorId: req.user?._id || null,
        type: "SYSTEM_TOTEM_VERIFICATION_APPROVED",
        targetType: "user",
        targetId: user._id,
        message: "Totem verification approved.",
        data: { note: adminNote || "" },
        isPersistent: false,
        dedupeKey: `verif:totem:${user._id}:approved`,
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }

    // 🧹 pulizia pending admin (se presente)
    await Notification.deleteMany({
      type: "ADMIN_TOTEM_VERIFICATION_PENDING",
      targetType: "user",
      targetId: user._id,
      dedupeKey: `admin:verif:totem:${user._id}:pending`,
    });

    return res.json({ status: "ok" });
  } catch (err) {
    console.error("admin totem approve error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/verifications/:userId/totem/reject
 * body: { reason } (OBBLIGATORIO)
 */
router.patch("/:userId/totem/reject", auth, adminGuard, async (req, res) => {
  try {
    const { userId } = req.params;
    const reason = (req.body?.reason || "").toString().trim();

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ status: "error", message: "Invalid user ID" });
    }
    if (!reason) {
      return res.status(400).json({ status: "error", message: "reason required" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    user.verificationTotemStatus = "rejected";
    await user.save();

    // 🔔 notifica utente
    try {
      await Notification.create({
        userId: user._id,
        actorId: req.user?._id || null,
        type: "SYSTEM_TOTEM_VERIFICATION_REJECTED",
        targetType: "user",
        targetId: user._id,
        message: "Totem verification rejected.",
        data: { reason },
        isPersistent: false,
        dedupeKey: `verif:totem:${user._id}:rejected`,
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }

    // 🧹 pulizia pending admin (se presente)
    await Notification.deleteMany({
      type: "ADMIN_TOTEM_VERIFICATION_PENDING",
      targetType: "user",
      targetId: user._id,
      dedupeKey: `admin:verif:totem:${user._id}:pending`,
    });

    return res.json({ status: "ok" });
  } catch (err) {
    console.error("admin totem reject error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/verifications/:userId/creator/approve
 */
router.patch("/:userId/creator/approve", auth, adminGuard, async (req, res) => {
  try {
    const { userId } = req.params;
    const adminNote = (req.body?.note || "").toString().trim() || null;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ status: "error", message: "Invalid user ID" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    user.creatorVerification = user.creatorVerification || {};
    user.creatorVerification.status = "approved";
    user.creatorVerification.verifiedAt = new Date();
    user.creatorVerification.verifiedByAdminId = req.user?._id || null;

    // Source of truth
    user.creatorEnabled = true;

    await user.save();

    // 🔔 user notification
    try {
      await Notification.create({
        userId: user._id,
        actorId: req.user?._id || null,
        type: "SYSTEM_CREATOR_VERIFICATION_APPROVED",
        targetType: "user",
        targetId: user._id,
        message: "Creator request approved.",
        data: { note: adminNote || "" },
        isPersistent: false,
        dedupeKey: `creator:${user._id}:approved`,
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }

    // 🧹 admin pending cleanup
    await Notification.updateMany(
      {
        type: "ADMIN_CREATOR_VERIFICATION_PENDING",
        targetType: "user",
        targetId: user._id,
        dedupeKey: `admin:creator:${user._id}:pending`,
        userId: null,
        isRead: false,
      },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.json({ status: "ok" });
  } catch (err) {
    console.error("admin creator approve error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/verifications/:userId/creator/reject
 * body: { reason } (OBBLIGATORIO)
 */
router.patch("/:userId/creator/reject", auth, adminGuard, async (req, res) => {
  try {
    const { userId } = req.params;
    const reason = (req.body?.reason || "").toString().trim();

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ status: "error", message: "Invalid user ID" });
    }
    if (!reason) {
      return res.status(400).json({ status: "error", message: "reason required" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    user.creatorVerification = user.creatorVerification || {};
    user.creatorVerification.status = "rejected";
    user.creatorVerification.rejectedAt = new Date();
    user.creatorVerification.rejectedByAdminId = req.user?._id || null;
    user.creatorVerification.rejectionReason = reason;

    // non tocchiamo accountType qui (potrebbe essere già creator per legacy)
    // ma in generale se era base, resta base

    await user.save();

    // 🔔 user notification
    try {
      await Notification.create({
        userId: user._id,
        actorId: req.user?._id || null,
        type: "SYSTEM_CREATOR_VERIFICATION_REJECTED",
        targetType: "user",
        targetId: user._id,
        message: "Creator request rejected.",
        data: { reason },
        isPersistent: false,
        dedupeKey: `creator:${user._id}:rejected`,
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
    }

    // 🧹 admin pending cleanup
    await Notification.updateMany(
      {
        type: "ADMIN_CREATOR_VERIFICATION_PENDING",
        targetType: "user",
        targetId: user._id,
        dedupeKey: `admin:creator:${user._id}:pending`,
        userId: null,
        isRead: false,
      },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.json({ status: "ok" });
  } catch (err) {
    console.error("admin creator reject error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
