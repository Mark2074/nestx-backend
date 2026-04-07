const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const User = require("../models/user");
const Notification = require("../models/notification");
const AdminAuditLog = require("../models/AdminAuditLog");
const { appendAccountTrustEvent } = require("../services/accountTrustRecordService");

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).trim();
  return req.ip || null;
}

async function logAdminCreatorDecision(req, targetUserId, decision, reason, extra = {}) {
  try {
    if (!req.user?._id) return;

    await AdminAuditLog.create({
      adminId: req.user._id,
      actionType: decision === "disable" || decision === "reenable"
        ? "ADMIN_CREATOR_DISABLED"
        : "ADMIN_CREATOR_DECISION",
      targetType: "user",
      targetId: String(targetUserId),
      meta: {
        decision: decision || null,
        reason: reason || null,
        ip: getClientIp(req),
        userAgent: (req.headers["user-agent"] || "").toString().slice(0, 500) || null,
        ...extra,
      },
    });
  } catch (e) {
    console.error("AdminAuditLog (creator decision) write failed:", e?.message || e);
  }
}

// ---------------------------------------------
// CREATOR VALIDATION (Stripe-first)
// NestX NON fa KYC interno: admin approva solo ruolo piattaforma
// API:
// GET    /api/admin/creator/pending
// GET    /api/admin/creator/active
// PATCH  /api/admin/creator/:userId/approve
// PATCH  /api/admin/creator/:userId/reject
// PATCH  /api/admin/creator/:userId/disable
// PATCH  /api/admin/creator/:userId/reenable
// ---------------------------------------------

// GET /api/admin/creator/pending
router.get("/creator/pending", auth, adminGuard, async (req, res) => {
  try {
    const items = await User.find({
      "creatorVerification.status": "pending",
    })
      .select("_id email displayName creatorVerification isCreator accountType creatorEnabled payoutEnabled payoutStatus")
      .sort({ "creatorVerification.submittedAt": -1 })
      .lean();

    return res.status(200).json({ status: "success", data: items });
  } catch (err) {
    console.error("admin creator pending error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// GET /api/admin/creator/active
router.get("/creator/active", auth, adminGuard, async (req, res) => {
  try {
    const filter = {};
    const onlyDisabled = String(req.query.disabled || "").trim().toLowerCase();

    filter.$or = [
      { accountType: "creator" },
      { isCreator: true },
      { "creatorVerification.status": "approved" },
    ];

    if (onlyDisabled === "true") {
      filter.creatorEnabled = false;
    }

    const items = await User.find(filter)
      .select(
        "_id email displayName isCreator accountType creatorEnabled creatorEligible creatorDisabledReason creatorDisabledAt payoutEnabled payoutStatus creatorVerification"
      )
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({ status: "success", data: items });
  } catch (err) {
    console.error("admin creator active error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// PATCH /api/admin/creator/:userId/approve
router.patch("/creator/:userId/approve", auth, adminGuard, async (req, res) => {
  try {
    const adminId = req.user?._id;
    const userId = req.params.userId;

    const u = await User.findById(userId).select("isCreator accountType creatorEnabled creatorVerification payoutEnabled payoutStatus");
    if (!u) return res.status(404).json({ status: "error", message: "User not found" });

    if (u.accountType === "admin") {
      return res.status(403).json({
        status: "error",
        message: "Admins cannot become creators",
      });
    }

    if (u.creatorVerification?.status !== "pending") {
      return res.status(409).json({ status: "error", message: "Creator request is not pending" });
    }

    u.isCreator = true;

    if (u.accountType !== "admin") {
      u.accountType = "creator";
    }

    u.creatorEnabled = true;
    u.creatorDisabledReason = null;
    u.creatorDisabledAt = null;

    u.creatorVerification.status = "approved";
    u.creatorVerification.verifiedAt = new Date();
    u.creatorVerification.verifiedByAdminId = adminId;

    if (typeof req.body?.adminNote === "string" && req.body.adminNote.trim()) {
      u.creatorVerification.note = req.body.adminNote.trim();
    }

    u.creatorVerification.rejectedAt = null;
    u.creatorVerification.rejectedByAdminId = null;
    u.creatorVerification.rejectionReason = null;

    await u.save();

    try {
      await Notification.create({
        userId: u._id,
        actorId: adminId,
        type: "SYSTEM_CREATOR_VERIFICATION_APPROVED",
        targetType: "user",
        targetId: u._id,
        message: "Creator request approved.",
        data: {},
        isPersistent: true,
        dedupeKey: `user:${u._id}:creator:approved:${u.creatorVerification.verifiedAt?.getTime?.() || Date.now()}`,
      });
    } catch (e) {
      if (e?.code !== 11000) console.error("notify creator approved error:", e);
    }

    await logAdminCreatorDecision(
      req,
      u._id,
      "approve",
      (typeof req.body?.adminNote === "string" && req.body.adminNote.trim()) ? req.body.adminNote.trim() : null
    );

    return res.status(200).json({ status: "success" });
  } catch (err) {
    console.error("admin creator approve error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// PATCH /api/admin/creator/:userId/reject
router.patch("/creator/:userId/reject", auth, adminGuard, async (req, res) => {
  try {
    const adminId = req.user?._id;
    const userId = req.params.userId;

    const u = await User.findById(userId).select("isCreator accountType creatorEnabled creatorVerification payoutEnabled payoutStatus");
    if (!u) return res.status(404).json({ status: "error", message: "User not found" });

    if (u.creatorVerification?.status !== "pending") {
      return res.status(409).json({ status: "error", message: "Creator request is not pending" });
    }

    u.isCreator = false;
    u.accountType = "base";
    u.creatorEnabled = false;
    u.creatorDisabledReason = "CREATOR_REQUEST_REJECTED";
    u.creatorDisabledAt = new Date();

    u.creatorVerification.status = "rejected";
    u.creatorVerification.rejectedAt = new Date();
    u.creatorVerification.rejectedByAdminId = adminId;

    if (typeof req.body?.adminNote === "string" && req.body.adminNote.trim()) {
      u.creatorVerification.note = req.body.adminNote.trim();
    }

    u.creatorVerification.rejectionReason = null;

    await u.save();

    try {
      await Notification.create({
        userId: u._id,
        actorId: adminId,
        type: "SYSTEM_CREATOR_VERIFICATION_REJECTED",
        targetType: "user",
        targetId: u._id,
        message: "Creator request rejected. You can reapply later.",
        data: {},
        isPersistent: true,
        dedupeKey: `user:${u._id}:creator:rejected:${u.creatorVerification.rejectedAt?.getTime?.() || Date.now()}`,
      });
    } catch (e) {
      if (e?.code !== 11000) console.error("notify creator rejected error:", e);
    }

    await logAdminCreatorDecision(
      req,
      u._id,
      "reject",
      (typeof req.body?.adminNote === "string" && req.body.adminNote.trim()) ? req.body.adminNote.trim() : null
    );

    return res.status(200).json({ status: "success" });
  } catch (err) {
    console.error("admin creator reject error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// PATCH /api/admin/creator/:userId/disable
router.patch("/creator/:userId/disable", auth, adminGuard, async (req, res) => {
  try {
    const adminId = req.user?._id;
    const userId = req.params.userId;
    const adminNote = String(req.body?.adminNote || "").trim();
    const disableReason = adminNote ? adminNote.slice(0, 300) : "ADMIN_DISABLED_CREATOR";

    const u = await User.findById(userId).select(`
      _id
      email
      displayName
      isCreator
      accountType
      creatorEligible
      creatorEnabled
      creatorDisabledReason
      creatorDisabledAt
      payoutEnabled
      payoutStatus
      creatorVerification
    `);

    if (!u) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const isCreatorApproved =
      (u.accountType === "creator" || u.isCreator === true || u.creatorVerification?.status === "approved");

    if (!isCreatorApproved) {
      return res.status(409).json({
        status: "error",
        code: "USER_NOT_ACTIVE_CREATOR",
        message: "User is not an active creator",
      });
    }

    if (u.creatorEnabled === false && u.payoutEnabled === false && u.payoutStatus === "disabled") {
      return res.status(200).json({
        status: "success",
        message: "Creator already disabled",
        data: {
          userId: u._id,
          creatorEnabled: false,
          payoutEnabled: false,
          payoutStatus: u.payoutStatus || "disabled",
          creatorDisabledReason: u.creatorDisabledReason || disableReason,
          creatorDisabledAt: u.creatorDisabledAt || null,
          alreadyDisabled: true,
        },
      });
    }

    u.creatorEnabled = false;
    u.creatorDisabledReason = disableReason;
    u.creatorDisabledAt = new Date();

    u.payoutEnabled = false;
    u.payoutStatus = "disabled";

    await u.save();

    try {
      await appendAccountTrustEvent({
        userId: u._id,
        kind: "creator_disabled",
        byAdminId: adminId,
        targetType: "user",
        targetId: u._id,
        note: adminNote || disableReason,
        reasonCode: "CREATOR_DISABLED",
        at: u.creatorDisabledAt || new Date(),
      });
    } catch (e) {
      console.error("account trust creator disable failed:", e?.message || e);
    }

    try {
      await Notification.create({
        userId: u._id,
        actorId: adminId,
        type: "SYSTEM_CREATOR_DISABLED",
        targetType: "user",
        targetId: u._id,
        message: "Creator monetization has been disabled by admin review.",
        data: {
          reason: disableReason,
          disabledAt: u.creatorDisabledAt,
        },
        isPersistent: true,
        dedupeKey: `user:${u._id}:creator:disabled:${u.creatorDisabledAt?.getTime?.() || Date.now()}`,
      });
    } catch (e) {
      if (e?.code !== 11000) console.error("notify creator disabled error:", e);
    }

    await logAdminCreatorDecision(req, u._id, "disable", disableReason, {
      creatorEnabled: false,
      payoutEnabled: false,
      payoutStatus: "disabled",
    });

    return res.status(200).json({
      status: "success",
      data: {
        userId: u._id,
        creatorEnabled: u.creatorEnabled,
        payoutEnabled: u.payoutEnabled,
        payoutStatus: u.payoutStatus,
        creatorDisabledReason: u.creatorDisabledReason,
        creatorDisabledAt: u.creatorDisabledAt,
        alreadyDisabled: false,
      },
    });
  } catch (err) {
    console.error("admin creator disable error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// PATCH /api/admin/creator/:userId/reenable
router.patch("/creator/:userId/reenable", auth, adminGuard, async (req, res) => {
  try {
    const adminId = req.user?._id;
    const userId = req.params.userId;
    const adminNote = String(req.body?.adminNote || "").trim();

    const u = await User.findById(userId).select(`
      _id
      email
      displayName
      isCreator
      accountType
      creatorEligible
      creatorEnabled
      creatorDisabledReason
      creatorDisabledAt
      payoutEnabled
      payoutStatus
      creatorVerification
    `);

    if (!u) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const isCreatorApproved =
      (u.accountType === "creator" || u.isCreator === true || u.creatorVerification?.status === "approved");

    if (!isCreatorApproved) {
      return res.status(409).json({
        status: "error",
        code: "USER_NOT_APPROVED_CREATOR",
        message: "User is not an approved creator",
      });
    }

    if (u.creatorEnabled === true) {
      return res.status(200).json({
        status: "success",
        message: "Creator already enabled",
        data: {
          userId: u._id,
          creatorEnabled: true,
          payoutEnabled: u.payoutEnabled,
          payoutStatus: u.payoutStatus,
          alreadyEnabled: true,
        },
      });
    }

    u.creatorEnabled = true;
    u.creatorDisabledReason = null;
    u.creatorDisabledAt = null;

    if (u.payoutProvider === "stripe") {
      if (u.creatorEligible === true) {
        u.payoutEnabled = true;
        u.payoutStatus = "verified";
      } else {
        u.payoutEnabled = false;
        u.payoutStatus = "pending";
      }
    } else {
      u.payoutEnabled = false;
      u.payoutStatus = "none";
    }

    await u.save();

    try {
      await appendAccountTrustEvent({
        userId: u._id,
        kind: "creator_reenabled",
        byAdminId: adminId,
        targetType: "user",
        targetId: u._id,
        note: adminNote || null,
        reasonCode: "CREATOR_REENABLED",
        at: new Date(),
      });
    } catch (e) {
      console.error("account trust creator reenable failed:", e?.message || e);
    }

    try {
      await Notification.create({
        userId: u._id,
        actorId: adminId,
        type: "SYSTEM_CREATOR_REENABLED",
        targetType: "user",
        targetId: u._id,
        message: "Creator monetization has been re-enabled.",
        data: {
          adminNote: adminNote || null,
          reenabledAt: new Date(),
          payoutEnabled: u.payoutEnabled,
          payoutStatus: u.payoutStatus,
        },
        isPersistent: true,
        dedupeKey: `user:${u._id}:creator:reenabled:${Date.now()}`,
      });
    } catch (e) {
      if (e?.code !== 11000) console.error("notify creator reenabled error:", e);
    }

    await logAdminCreatorDecision(req, u._id, "reenable", adminNote || null, {
      creatorEnabled: true,
      payoutEnabled: u.payoutEnabled,
      payoutStatus: u.payoutStatus,
    });

    return res.status(200).json({
      status: "success",
      data: {
        userId: u._id,
        creatorEnabled: u.creatorEnabled,
        payoutEnabled: u.payoutEnabled,
        payoutStatus: u.payoutStatus,
        creatorDisabledReason: u.creatorDisabledReason,
        creatorDisabledAt: u.creatorDisabledAt,
        alreadyEnabled: false,
      },
    });
  } catch (err) {
    console.error("admin creator reenable error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;