// routes/adminReportsRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const Report = require("../models/Report");
const AdminAuditLog = require("../models/AdminAuditLog");
const AccountTrustRecord = require("../models/AccountTrustRecord");
const Post = require("../models/Post");
const Event = require("../models/event");
const Notification = require("../models/notification");
const User = require("../models/user");
const Comment = require("../models/Comment");
const LiveMessage = require("../models/LiveMessage");
const Ticket = require("../models/ticket");
const { adminRefundTicketById } = require("./adminRefundRoutes");
const { appendAccountTrustEvent } = require("../services/accountTrustRecordService");

function mapReasonCodeToLabel(reasonCode) {
  switch (String(reasonCode || "").trim()) {
    case "minor_involved":
      return "Minor involved";
    case "illegal_content":
      return "Illegal content";
    case "violent_or_gore_content":
      return "Violent or gore content";
    case "violent_extremism_or_propaganda":
      return "Violent extremism or propaganda";
    case "harassment_or_threats":
      return "Harassment or threats";
    case "spam_or_scam":
      return "Spam or scam";
    case "impersonation_or_fake":
      return "Impersonation or fake";
    case "other":
      return "Other";
    default:
      return "Unknown";
  }
}

function pickOwnerUserIdFromDoc(targetType, doc) {
  if (!doc) return null;

  if (targetType === "user") return doc._id || null;
  if (targetType === "post") return doc.authorId || null;
  if (targetType === "event") return doc.creatorId || null;
  if (targetType === "comment") return doc.authorId || doc.userId || null;
  if (targetType === "live_message") return doc.userId || doc.authorId || null;

  return null;
}

async function hydrateUserLite(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;

  const u = await User.findById(userId)
    .select("_id username displayName avatar accountType isCreator creatorEnabled")
    .lean();

  if (!u) return null;

  return {
    userId: String(u._id),
    username: u.username || null,
    displayName: u.displayName || null,
    avatar: u.avatar || null,
    accountType: u.accountType || null,
    isCreator: Boolean(u.isCreator),
    creatorEnabled: Boolean(u.creatorEnabled),
  };
}

async function buildAdminEventSnapshot(eventId) {
  if (!eventId || !mongoose.Types.ObjectId.isValid(String(eventId))) return null;

  const event = await Event.findById(eventId)
    .select("_id title creatorId status startTime startedAt endedAt accessScope ticketPriceTokens privateSession roomId viewerCount createdAt updatedAt")
    .lean();

  if (!event) return null;

  const creator = await hydrateUserLite(event.creatorId);

  return {
    eventId: String(event._id),
    title: event.title || null,
    creatorId: event.creatorId ? String(event.creatorId) : null,
    creator,
    status: event.status || null,

    startAt:
      event.endedAt ||
      event.actualLiveEndTime ||
      event.startedAt ||
      event.actualLiveStartTime ||
      event.startTime ||
      null,

    endAt:
      event.endedAt ||
      event.actualLiveEndTime ||
      event.updatedAt ||
      null,

    accessScope: event.accessScope || null,
    ticketPriceTokens: Number(event.ticketPriceTokens || 0),
    viewerCount: Number(event.viewerCount || 0),

    roomId: event.roomId ? String(event.roomId) : null,

    privateSession: event.privateSession
      ? {
          isEnabled: Boolean(event.privateSession.isEnabled),
          status: event.privateSession.status || null,
          seats: Number(event.privateSession.seats || 0),
          ticketPriceTokens: Number(event.privateSession.ticketPriceTokens || 0),
          reservedByUserId: event.privateSession.reservedByUserId
            ? String(event.privateSession.reservedByUserId)
            : null,
          reservedAt: event.privateSession.reservedAt || null,
          acceptedAt: event.privateSession.acceptedAt || null,
          economicStatus: event.privateSession.economicStatus || null,
          economicHeldTokens: Number(event.privateSession.economicHeldTokens || 0),
          economicHeldAt: event.privateSession.economicHeldAt || null,
          economicReleasedAt: event.privateSession.economicReleasedAt || null,
          economicFrozenAt: event.privateSession.economicFrozenAt || null,
          economicRefundedAt: event.privateSession.economicRefundedAt || null,
          economicResolutionReason: event.privateSession.economicResolutionReason || null,
        }
      : null,

    createdAt: event.createdAt || null,
    updatedAt: event.updatedAt || null,
  };
}

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

/**
 * GET /api/admin/reports
 * Query: status, targetType, q, limit, skip, sort
 */
router.get("/reports", auth, adminGuard, async (req, res) => {
  try {
    // --- FILTRI LISTA REPORT (dentro la GET /reports) ---
    const statusRaw = (req.query.status || "pending").trim().toLowerCase();
    const targetTypeRaw = (req.query.targetType || "all").trim().toLowerCase();
    const q = (req.query.q || "").trim();

    const sourceRaw = (req.query.source || "all").trim().toLowerCase();
    const priorityRaw = (req.query.priority || "all").trim().toUpperCase();

    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 200));
    const skip = Math.max(0, parseInt(req.query.skip || "0", 10));
    const sortDir = (req.query.sort || "new").trim().toLowerCase() === "old" ? 1 : -1;

    const query = {};

    // status
    const allowedStatus = ["pending", "reviewed", "dismissed", "actioned", "all"];
    const safeStatus = allowedStatus.includes(statusRaw) ? statusRaw : "pending";
    if (safeStatus !== "all") query.status = safeStatus;

    // targetType
    const allowedTarget = ["user", "post", "event", "comment", "live_message", "all"];
    const safeTarget = allowedTarget.includes(targetTypeRaw) ? targetTypeRaw : "all";
    if (safeTarget !== "all") query.targetType = safeTarget;

    const allowedSource = ["user", "ai", "all"];
    const safeSource = allowedSource.includes(sourceRaw) ? sourceRaw : "all";
    if (safeSource !== "all") query.source = safeSource;

    // search (reason + note)
    if (q) {
      query.$or = [
        { reason: { $regex: q, $options: "i" } },
        { note: { $regex: q, $options: "i" } },
      ];
    }

    const allowedPriority = ["P0", "P1", "P2", "P3", "P4", "ALL"];
    const safePriority = allowedPriority.includes(priorityRaw) ? priorityRaw : "ALL";
    if (safePriority !== "ALL") query.severity = safePriority;

    // IMPORTANTISSIMO: qui total viene definito davvero
    const [items, total] = await Promise.all([
      Report.find(query)
        .sort({
          source: -1,          // ai prima di user
          status: 1,           // hidden/pending/reviewed...
          priorityScore: 1,    // 0 prima di 4
          createdAt: sortDir,
        })
        .skip(skip)
        .limit(limit),
      Report.countDocuments(query),
    ]);

    return res.json({
      status: "ok",
      total,
      limit,
      skip,
      items,
    });

  } catch (err) {
    console.error("Admin reports list error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/reports/:id
 * Body: { status: pending | hidden | reviewed | dismissed | actioned }
 */
router.patch("/reports/:id", auth, adminGuard, async (req, res) => {
  try {
    const { status, adminNote, severity, category } = req.body;
    const quickAction = String(req.body?.quickAction || "").trim().toLowerCase();

    const safeStatus = String(status || "").trim().toLowerCase();



    const allowed = ["pending", "reviewed", "hidden", "dismissed", "actioned"];
    if (!allowed.includes(safeStatus)) {
      return res.status(400).json({ status: "error", message: "invalid status" });
    }

    const allowedQuickActions = ["", "ban", "suspend_7d"];
    if (!allowedQuickActions.includes(quickAction)) {
      return res.status(400).json({ status: "error", message: "invalid quickAction" });
    }

    if (quickAction && safeStatus !== "actioned") {
      return res.status(400).json({ status: "error", message: "quickAction allowed only with actioned status" });
    }

    const existing = await Report.findById(req.params.id).lean();
    if (!existing) {
      return res.status(404).json({ status: "error", message: "Report not found" });
    }

    let safeSeverity = null;
    let safeCategory = null;

    if (safeStatus === "actioned") {
      safeSeverity = String(severity || "").trim().toLowerCase();
      if (!["grave", "gravissimo"].includes(safeSeverity)) {
        return res.status(400).json({ status: "error", message: "severity required (grave|gravissimo)" });
      }
      safeCategory = category ? String(category).trim() : null;
    }

    // HIDE POST when hidden (Phase 1 rule)
    if (
      existing.targetType === "post" &&
      existing.targetId &&
      safeStatus === "hidden"
    ) {
      try {
        await Post.updateOne(
          { _id: existing.targetId },
          {
            $set: {
              isHidden: true,
              "moderation.status": "under_review",
              "moderation.hiddenBy": "admin",
              "moderation.hiddenAt": new Date(),
              "moderation.hiddenByAdminId": req.user._id,
            },
          }
        );
      } catch (e) {
        console.warn("HIDE_POST failed:", e?.message || e);
      }
    }

    // HIDE POST when hidden (Phase 1 rule)
    if (
      existing.targetType === "comment" &&
      existing.targetId &&
      safeStatus === "hidden"
    ) {
      try {
        await Comment.updateOne(
          { _id: existing.targetId },
          {
            $set: {
              "moderation.status": "under_review",
              "moderation.hiddenBy": "admin",
              "moderation.hiddenAt": new Date(),
            },
          }
        );
      } catch (e) {
        console.warn("HIDE_COMMENT failed:", e?.message || e);
      }
    }

    if (
      existing.targetType === "live_message" &&
      existing.targetId &&
      safeStatus === "hidden"
    ) {
      try {
        await LiveMessage.updateOne(
          { _id: existing.targetId },
          {
            $set: {
              "moderation.status": "under_review",
              "moderation.hiddenBy": "admin",
              "moderation.hiddenAt": new Date(),
            },
          }
        );
      } catch (e) {
        console.warn("HIDE_LIVE_MESSAGE failed:", e?.message || e);
      }
    }

    // HIDE POST when actioned (Phase 1 rule: confirmed grave/gravissimo -> hide)
    if (
      existing.targetType === "post" &&
      existing.targetId &&
      safeStatus === "actioned"
    ) {
      try {
        await Post.updateOne(
          { _id: existing.targetId },
          {
            $set: {
              isHidden: true,
              "moderation.status": "hidden",
              "moderation.hiddenBy": "admin",
              "moderation.hiddenSeverity": safeSeverity,
              "moderation.hiddenCategory": safeCategory,
              "moderation.hiddenAt": new Date(),
              "moderation.hiddenByAdminId": req.user._id,
            },
          }
        );
      } catch (e) {
        console.warn("Post hide (actioned) skipped:", e?.message || e);
      }
    }

    if (
      existing.targetType === "comment" &&
      existing.targetId &&
      safeStatus === "actioned"
    ) {
      try {
        await Comment.updateOne(
          { _id: existing.targetId },
          {
            $set: {
              "moderation.status": "hidden",
              "moderation.hiddenBy": "admin",
              "moderation.hiddenSeverity": safeSeverity,
              "moderation.hiddenCategory": safeCategory,
              "moderation.hiddenAt": new Date(),
              "moderation.hiddenByAdminId": req.user._id,
            },
          }
        );
      } catch (e) {
        console.warn("Comment hide (actioned) skipped:", e?.message || e);
      }
    }

    if (
      existing.targetType === "live_message" &&
      existing.targetId &&
      safeStatus === "actioned"
    ) {
      try {
        await LiveMessage.updateOne(
          { _id: existing.targetId },
          {
            $set: {
              "moderation.status": "hidden",
              "moderation.hiddenBy": "admin",
              "moderation.hiddenSeverity": safeSeverity,
              "moderation.hiddenCategory": safeCategory,
              "moderation.hiddenAt": new Date(),
              "moderation.hiddenByAdminId": req.user._id,
            },
          }
        );
      } catch (e) {
        console.warn("LiveMessage hide (actioned) skipped:", e?.message || e);
      }
    }

    if (
      existing.targetType === "post" &&
      existing.targetId &&
      (safeStatus === "dismissed" || safeStatus === "reviewed")
    ) {
      try {
        await Post.updateOne(
          { _id: existing.targetId },
          {
            $set: {
              isHidden: false,
              "moderation.status": "visible",
              "moderation.hiddenBy": null,
              "moderation.hiddenReason": null,
              "moderation.hiddenSeverity": null,
              "moderation.hiddenCategory": null,
              "moderation.hiddenAt": null,
              "moderation.hiddenByAdminId": null,
              "moderation.ai.flagged": false,
              "moderation.ai.score": 0,
              "moderation.ai.labels": [],
            },
          }
        );
      } catch (e) {
        console.warn("Post restore skipped:", e?.message || e);
      }
    }

    if (
      existing.targetType === "comment" &&
      existing.targetId &&
      (safeStatus === "dismissed" || safeStatus === "reviewed")
    ) {
      try {
        await Comment.updateOne(
          { _id: existing.targetId },
          {
            $set: {
              "moderation.status": "visible",
              "moderation.hiddenBy": null,
              "moderation.hiddenReason": null,
              "moderation.hiddenSeverity": null,
              "moderation.hiddenCategory": null,
              "moderation.hiddenAt": null,
              "moderation.hiddenByAdminId": null,
              "moderation.ai.flagged": false,
              "moderation.ai.score": 0,
              "moderation.ai.labels": [],
            },
          }
        );
      } catch (e) {
        console.warn("Comment restore skipped:", e?.message || e);
      }
    }

    if (
      existing.targetType === "live_message" &&
      existing.targetId &&
      (safeStatus === "dismissed" || safeStatus === "reviewed")
    ) {
      try {
        await LiveMessage.updateOne(
          { _id: existing.targetId },
          {
            $set: {
              "moderation.status": "visible",
              "moderation.hiddenBy": null,
              "moderation.hiddenReason": null,
              "moderation.hiddenSeverity": null,
              "moderation.hiddenCategory": null,
              "moderation.hiddenAt": null,
              "moderation.hiddenByAdminId": null,
              "moderation.ai.flagged": false,
              "moderation.ai.score": 0,
              "moderation.ai.labels": [],
            },
          }
        );
      } catch (e) {
        console.warn("LiveMessage restore skipped:", e?.message || e);
      }
    }

    const updateDoc = {
      status: safeStatus,
      adminNote: adminNote || null,

      // solo se actioned
      confirmedSeverity: safeStatus === "actioned" ? safeSeverity : null,
      confirmedCategory: safeStatus === "actioned" ? safeCategory : null,
    };

    // reviewed* SOLO quando esce da pending
    if (safeStatus !== "pending") {
      updateDoc.reviewedBy = req.user._id;
      updateDoc.reviewedAt = new Date();
    } else {
      // se qualcuno rimette pending, deve tornare "non reviewato"
      updateDoc.reviewedBy = null;
      updateDoc.reviewedAt = null;

      // e anche action fields devono essere null (già lo sono sopra)
    }

    const updated = await Report.findByIdAndUpdate(req.params.id, updateDoc, { new: true });

    if (!updated) {
      return res.status(404).json({ status: "error", message: "Report not found" });
    }

    let auditActionType = "REVIEW_REPORT";

    if (safeStatus === "actioned") auditActionType = "ACTION_REPORT";
    else if (safeStatus === "dismissed") auditActionType = "DISMISS_REPORT";
    else if (safeStatus === "hidden") auditActionType = "HIDE_REPORT";
    else if (safeStatus === "reviewed") auditActionType = "REVIEW_REPORT";
    else if (safeStatus === "pending") auditActionType = "REOPEN_REPORT";

    try {
      await AdminAuditLog.create({
        adminId: req.user._id,
        actionType: auditActionType,
        targetType: "report",
        targetId: String(updated._id),
        meta: {
          reporterId: updated?.reporterId ? String(updated.reporterId) : null,
          reportReason: updated?.reason || null,
          reportNote: updated?.note || null,
          reportSeverity: updated?.severity || null,

          previousStatus: existing?.status || null,
          newStatus: safeStatus,
          adminNote: adminNote || null,
          severity: safeStatus === "actioned" ? safeSeverity : null,
          category: safeStatus === "actioned" ? safeCategory : null,

          reportTargetType: existing?.targetType || null,
          reportTargetId: existing?.targetId ? String(existing.targetId) : null,
          contextType: existing?.contextType || null,
          contextId: existing?.contextId ? String(existing.contextId) : null,
          quickAction: quickAction || null,
        },
      });
    } catch (e) {
      console.warn("AdminAuditLog skipped:", e?.message || e);
    }

    let ownerId = existing.targetOwnerId ? String(existing.targetOwnerId) : null;

    if (!ownerId) {
      if (existing.targetType === "user") {
        ownerId = existing.targetId ? String(existing.targetId) : null;
      } else if (existing.targetType === "post") {
        const p = await Post.findById(existing.targetId).select("authorId").lean();
        ownerId = p?.authorId ? String(p.authorId) : null;
      } else if (existing.targetType === "event") {
        const ev = await Event.findById(existing.targetId).select("creatorId").lean();
        ownerId = ev?.creatorId ? String(ev.creatorId) : null;
      } else if (existing.targetType === "comment") {
        const c = await Comment.findById(existing.targetId).select("authorId userId").lean();
        ownerId = c?.authorId
          ? String(c.authorId)
          : c?.userId
          ? String(c.userId)
          : null;
      } else if (existing.targetType === "live_message") {
        const lm = await LiveMessage.findById(existing.targetId).select("userId authorId").lean();
        ownerId = lm?.userId
          ? String(lm.userId)
          : lm?.authorId
          ? String(lm.authorId)
          : null;
      }

      if (ownerId) {
        await Report.updateOne({ _id: updated._id }, { $set: { targetOwnerId: ownerId } });
      }
    }

    if (ownerId && safeStatus !== "pending") {
      let adminOutcome = "resolve";

      if (safeStatus === "hidden") adminOutcome = "hide_target";
      else if (safeStatus === "dismissed") adminOutcome = "dismiss";
      else if (safeStatus === "reviewed") adminOutcome = "resolve";
      else if (safeStatus === "actioned" && safeSeverity === "gravissimo") adminOutcome = "action_gravissimo";
      else if (safeStatus === "actioned") adminOutcome = "action_grave";

      await appendAccountTrustEvent({
        userId: ownerId,
        kind: "report_actioned",
        byAdminId: req.user._id,
        reportId: updated._id,
        targetType: existing.targetType,
        targetId: existing.targetId,
        severity: safeStatus === "actioned" ? safeSeverity : null,
        category: safeStatus === "actioned" ? safeCategory : null,
        note: adminNote || null,
        reasonCode: existing.reasonCode || null,
        reportReason: existing.reason || null,
        userMessage: existing.note || null,
        adminOutcome,
        adminNote: adminNote || null,
        at: new Date(),
      });
    }

    if (ownerId && quickAction) {
      const moderationPatch = {};

      if (quickAction === "ban") {
        moderationPatch.isBanned = true;
        moderationPatch.bannedAt = new Date();
        moderationPatch.banReason = adminNote || "report_actioned_ban";
        moderationPatch.bannedByAdminId = req.user._id;

        moderationPatch.isSuspended = false;
        moderationPatch.suspendedUntil = null;
        moderationPatch.suspendReason = null;
        moderationPatch.suspendedByAdminId = null;
      }

      if (quickAction === "suspend_7d") {
        moderationPatch.isBanned = false;
        moderationPatch.bannedAt = null;
        moderationPatch.banReason = null;
        moderationPatch.bannedByAdminId = null;

        moderationPatch.isSuspended = true;
        moderationPatch.suspendedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        moderationPatch.suspendReason = adminNote || "report_actioned_suspend";
        moderationPatch.suspendedByAdminId = req.user._id;
      }

      if (Object.keys(moderationPatch).length > 0) {
        await User.updateOne(
          { _id: ownerId },
          { $set: moderationPatch }
        );

        try {
          await AdminAuditLog.create({
            adminId: req.user._id,
            actionType: "USER_MODERATION",
            targetType: "user",
            targetId: String(ownerId),
            meta: {
              source: "report_quick_action",
              reportId: String(updated._id),
              quickAction,
              adminNote: adminNote || null,
            },
          });
        } catch (e) {
          console.warn("Quick action audit skipped:", e?.message || e);
        }
      }
    }

    // 🧹 chiudi notifica admin REPORT pending (queue) se il report esce da pending
    if (safeStatus !== "pending") {
      await Notification.updateMany(
        {
          userId: null,
          isRead: false,
          type: "ADMIN_REPORT_PENDING",
          dedupeKey: `admin:report:${updated._id}:pending`,
        },
        { $set: { isRead: true, readAt: new Date() } }
      );
    }

    return res.status(200).json({ status: "success", data: updated });
  } catch (err) {
    console.error("Admin report update error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * GET /api/admin/reports/:id/detail
 * Report detail for admin drawer
 */
router.get("/reports/:id/detail", auth, adminGuard, async (req, res) => {
  try {
    const reportId = String(req.params.id || "").trim();

    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ status: "error", message: "Invalid report id" });
    }

    const report = await Report.findById(reportId)
      .populate("reporterId", "username displayName avatar")
      .lean();

    if (!report) {
      return res.status(404).json({ status: "error", message: "Report not found" });
    }

    let targetOwnerId = report.targetOwnerId ? String(report.targetOwnerId) : null;
    let targetDoc = null;

    if (report.targetType === "user") {
      targetDoc = await User.findById(report.targetId)
        .select("_id username displayName avatar accountType isCreator creatorEnabled")
        .lean();
    } else if (report.targetType === "post") {
      targetDoc = await Post.findById(report.targetId)
        .select("_id authorId text moderation isHidden")
        .lean();
    } else if (report.targetType === "event") {
      targetDoc = await Event.findById(report.targetId)
        .select("_id title creatorId status startAt endAt accessScope type ticketPriceTokens privateSession roomId")
        .lean();
    } else if (report.targetType === "comment") {
      targetDoc = await Comment.findById(report.targetId)
        .select("_id authorId userId text body moderation postId")
        .lean();
    } else if (report.targetType === "live_message") {
      targetDoc = await LiveMessage.findById(report.targetId)
        .select("_id userId authorId text message moderation eventId roomId")
        .lean();
    }

    if (!targetOwnerId) {
      const ownerIdRaw = pickOwnerUserIdFromDoc(report.targetType, targetDoc);
      targetOwnerId = ownerIdRaw ? String(ownerIdRaw) : null;

      if (targetOwnerId) {
        await Report.updateOne(
          { _id: report._id },
          { $set: { targetOwnerId } }
        );
      }
    }

    const owner = targetOwnerId ? await hydrateUserLite(targetOwnerId) : null;

    let ownerModeration = null;
    if (targetOwnerId && mongoose.Types.ObjectId.isValid(targetOwnerId)) {
      const ownerMod = await User.findById(targetOwnerId)
        .select("_id isBanned bannedAt banReason isSuspended suspendedUntil suspendReason")
        .lean();

      if (ownerMod) {
        ownerModeration = {
          userId: String(ownerMod._id),
          isBanned: Boolean(ownerMod.isBanned),
          bannedAt: ownerMod.bannedAt || null,
          banReason: ownerMod.banReason || null,
          isSuspended: Boolean(ownerMod.isSuspended),
          suspendedUntil: ownerMod.suspendedUntil || null,
          suspendReason: ownerMod.suspendReason || null,
        };
      }
    }

    let reportType = "generic_report";

    if (report.targetType === "user" && report.contextType === "live" && report.contextId) {
      reportType = "user_live_context_report";
    } else if (report.targetType === "user") {
      reportType = "generic_user_report";
    } else if (report.targetType === "event") {
      reportType = "event_report";
    } else if (report.targetType === "post") {
      reportType = "post_report";
    } else if (report.targetType === "comment") {
      reportType = "comment_report";
    } else if (report.targetType === "live_message") {
      reportType = "live_message_report";
    }

    let linkedEventId = null;

    if (report.targetType === "event" && report.targetId) {
      linkedEventId = String(report.targetId);
    } else if (report.contextType === "live" && report.contextId) {
      linkedEventId = String(report.contextId);
    } else if (report.targetType === "live_message" && targetDoc?.eventId) {
      linkedEventId = String(targetDoc.eventId);
    }

    const eventBase = linkedEventId
      ? await buildAdminEventSnapshot(linkedEventId)
      : null;

    let reporterHasPaidTicket = null;
    let reporterTicket = null;

    if (
      report.reporterId &&
      linkedEventId &&
      eventBase &&
      Number(eventBase.ticketPriceTokens || 0) > 0 &&
      mongoose.Types.ObjectId.isValid(String(report.reporterId._id || report.reporterId))
    ) {
      const reporterIdStr = String(report.reporterId._id || report.reporterId);

      const ticketDoc = await Ticket.findOne({
        eventId: linkedEventId,
        userId: reporterIdStr,
        status: "active",
      })
        .sort({ purchasedAt: -1, createdAt: -1 })
        .lean();

      reporterHasPaidTicket = !!ticketDoc;

      if (ticketDoc) {
        reporterTicket = {
          ticketId: String(ticketDoc._id),
          scope: ticketDoc.scope || "public",
          roomId: ticketDoc.roomId || null,
          priceTokens: Number(ticketDoc.priceTokens || 0),
          purchasedAt: ticketDoc.purchasedAt || ticketDoc.createdAt || null,
          status: ticketDoc.status || null,
        };
      }
    }

    const eventLinked = eventBase
      ? {
          ...eventBase,
          reporterHasPaidTicket,
          reporterTicket,
        }
      : null;

    const creator =
      eventLinked?.creator ||
      (owner?.isCreator ? owner : null);

    return res.json({
      status: "ok",
      data: {
        _id: String(report._id),
        reportId: String(report._id),

        reportType,

        targetType: report.targetType || null,
        targetId: report.targetId ? String(report.targetId) : null,

        contextType: report.contextType || null,
        contextId: report.contextId ? String(report.contextId) : null,

        reasonCode: report.reasonCode || null,
        reason: report.reason || "",
        reasonLabel: mapReasonCodeToLabel(report.reasonCode),

        note: report.note || "",
        userMessage: report.note || "",

        status: report.status || "pending",
        severity: report.severity || null,
        source: report.source || "user",
        aiReview: report.aiReview || { score: 0, labels: [], suggestedSeverity: null },

        confirmedSeverity: report.confirmedSeverity || null,
        confirmedCategory: report.confirmedCategory || null,
        adminNote: report.adminNote || null,

        targetOwnerId: targetOwnerId || null,
        owner,
        creator,
        ownerModeration,

        reporter: report.reporterId
          ? {
              userId: String(report.reporterId._id),
              username: report.reporterId.username || null,
              displayName: report.reporterId.displayName || null,
              avatar: report.reporterId.avatar || null,
            }
          : null,

        eventLinked,

        createdAt: report.createdAt || null,
        updatedAt: report.updatedAt || null,
        reviewedAt: report.reviewedAt || null,

        creatorDecision: report.creatorDecision
          ? {
              type: report.creatorDecision.type || null,
              note: report.creatorDecision.note || null,
              appliedAt: report.creatorDecision.appliedAt || null,
              appliedBy: report.creatorDecision.appliedBy
                ? String(report.creatorDecision.appliedBy)
                : null,
            }
          : null,
      }
    });
  } catch (err) {
    console.error("Admin report detail error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

router.patch("/reports/:id/creator-decision", auth, adminGuard, async (req, res) => {
  try {
    const reportId = String(req.params.id || "").trim();
    const decision = String(req.body?.decision || "").trim();
    const note = String(req.body?.note || "").trim();

    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ status: "error", message: "Invalid report id" });
    }

    const allowed = ["refund", "revoke_creator", "refund_revoke_creator"];
    if (!allowed.includes(decision)) {
      return res.status(400).json({ status: "error", message: "Invalid creator decision" });
    }

    if (note.length < 3) {
      return res.status(400).json({ status: "error", message: "Admin note is required" });
    }

    const report = await Report.findById(reportId).lean();
    if (!report) {
      return res.status(404).json({ status: "error", message: "Report not found" });
    }

    if (report?.creatorDecision?.type) {
      return res.status(409).json({ status: "error", message: "Creator decision already applied" });
    }

    let ownerId = report.targetOwnerId ? String(report.targetOwnerId) : null;

    if (!ownerId) {
      if (report.targetType === "user") {
        ownerId = report.targetId ? String(report.targetId) : null;
      } else if (report.targetType === "post") {
        const p = await Post.findById(report.targetId).select("authorId").lean();
        ownerId = p?.authorId ? String(p.authorId) : null;
      } else if (report.targetType === "event") {
        const ev = await Event.findById(report.targetId).select("creatorId").lean();
        ownerId = ev?.creatorId ? String(ev.creatorId) : null;
      } else if (report.targetType === "comment") {
        const c = await Comment.findById(report.targetId).select("authorId userId").lean();
        ownerId = c?.authorId
          ? String(c.authorId)
          : c?.userId
          ? String(c.userId)
          : null;
      } else if (report.targetType === "live_message") {
        const lm = await LiveMessage.findById(report.targetId).select("userId authorId").lean();
        ownerId = lm?.userId
          ? String(lm.userId)
          : lm?.authorId
          ? String(lm.authorId)
          : null;
      }

      if (ownerId) {
        await Report.updateOne({ _id: reportId }, { $set: { targetOwnerId: ownerId } });
      }
    }

    const linkedEventId =
      report.targetType === "event" && report.targetId
        ? String(report.targetId)
        : report.contextType === "live" && report.contextId
        ? String(report.contextId)
        : null;

    let ticketId = null;
    let refundApplied = false;
    let revokeApplied = false;

    if (decision === "refund" || decision === "refund_revoke_creator") {
      if (!linkedEventId || !report.reporterId) {
        return res.status(400).json({ status: "error", message: "Refund not applicable" });
      }

      const ticketDoc = await Ticket.findOne({
        eventId: linkedEventId,
        userId: report.reporterId,
        status: "active",
      })
        .sort({ purchasedAt: -1, createdAt: -1 })
        .lean();

      if (!ticketDoc?._id) {
        return res.status(400).json({ status: "error", message: "Refund not applicable" });
      }

      ticketId = String(ticketDoc._id);

      await adminRefundTicketById({
        ticketId,
        adminId: req.user._id,
        note,
      });

      refundApplied = true;
    }

    if (decision === "revoke_creator" || decision === "refund_revoke_creator") {
      if (!ownerId) {
        return res.status(400).json({ status: "error", message: "Missing target owner" });
      }

      await User.updateOne(
        { _id: ownerId },
        {
          $set: {
            creatorEnabled: false,
            creatorDisabledReason: note || "REPORT_CREATOR_REVOKED",
            creatorDisabledAt: new Date(),
            payoutEnabled: false,
            payoutStatus: "disabled",
          },
        }
      );

      try {
        await AdminAuditLog.create({
          adminId: req.user._id,
          actionType: "ADMIN_CREATOR_DISABLED",
          targetType: "user",
          targetId: String(ownerId),
          meta: {
            source: "report_creator_decision",
            reportId,
            decision,
            adminNote: note,
          },
        });
      } catch (e) {
        console.warn("Creator revoke audit skipped:", e?.message || e);
      }

      revokeApplied = true;
    }

    const now = new Date();

    const updated = await Report.findByIdAndUpdate(
      reportId,
      {
        $set: {
          creatorDecision: {
            type: decision,
            note,
            appliedAt: now,
            appliedBy: req.user._id,
          },
        },
      },
      { new: true }
    );

    if (ownerId) {
      await appendAccountTrustEvent({
        userId: ownerId,
        kind: decision === "refund" ? "private_funds_refunded" : "creator_disabled",
        byAdminId: req.user._id,
        reportId: report._id,
        targetType: report.targetType || "user",
        targetId: report.targetId || ownerId,
        eventId: linkedEventId || null,
        note: note || null,
        reasonCode: report.reasonCode || null,
        reportReason: report.reason || null,
        userMessage: report.note || null,
        adminOutcome: decision,
        adminNote: note || null,
        at: now,
      });
    }
    
    try {
      await AdminAuditLog.create({
        adminId: req.user._id,
        actionType: "REPORT_CREATOR_DECISION",
        targetType: "report",
        targetId: reportId,
        meta: {
          decision,
          note,
          refundApplied,
          revokeApplied,
          ticketId,
          ownerId: ownerId || null,
          linkedEventId: linkedEventId || null,
        },
      });
    } catch (e) {
      console.warn("Creator decision audit skipped:", e?.message || e);
    }

    return res.json({
      status: "ok",
      data: updated,
    });
  } catch (err) {
    console.error("Admin creator decision error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

router.get("/events/:id/detail", auth, adminGuard, async (req, res) => {
  try {
    const eventId = String(req.params.id || "").trim();

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ status: "error", message: "Invalid event id" });
    }

    const eventData = await buildAdminEventSnapshot(eventId);

    if (!eventData) {
      return res.status(404).json({ status: "error", message: "Event not found" });
    }

    return res.json({
      status: "ok",
      data: eventData,
    });
  } catch (err) {
    console.error("Admin event detail error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/users/:id/moderation
 * Body: { action: "suspend_7d" | "unsuspend" | "ban" | "unban", adminNote: string }
 */
router.patch("/users/:id/moderation", auth, adminGuard, async (req, res) => {
  try {
    const userId = req.params.id;
    const action = String(req.body?.action || "").trim();
    const adminNote = String(req.body?.adminNote || "").trim();

    if (!userId || String(userId).length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid user ID" });
    }

    const allowed = ["suspend_7d", "unsuspend", "ban", "unban"];
    if (!allowed.includes(action)) {
      return res.status(400).json({ status: "error", message: "Invalid action" });
    }

    if ((action === "suspend_7d" || action === "ban") && adminNote.length < 3) {
      return res.status(400).json({ status: "error", message: "adminNote is required" });
    }

    const target = await User.findById(userId).select("_id accountType isBanned isSuspended suspendedUntil").lean();
    if (!target) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const before = {
      isBanned: target?.isBanned ?? null,
      isSuspended: target?.isSuspended ?? null,
      suspendedUntil: target?.suspendedUntil ?? null,
    };

    // optional safety: avoid banning yourself
    if (String(req.user._id) === String(userId) && (action === "ban" || action === "suspend_7d")) {
      return res.status(400).json({ status: "error", message: "Cannot moderate yourself" });
    }

    // optional safety: avoid moderating other admins (if you want)
    // if (target.accountType === "admin") return res.status(403).json({ status: "error", message: "Cannot moderate admin" });

    const now = new Date();
    const patch = {};

    if (action === "ban") {
      patch.isBanned = true;
      patch.bannedAt = now;
      patch.banReason = adminNote || null;
      patch.bannedByAdminId = req.user._id;

      // ban implies unsuspend
      patch.isSuspended = false;
      patch.suspendedUntil = null;
      patch.suspendReason = null;
      patch.suspendedByAdminId = null;
    }

    if (action === "unban") {
      patch.isBanned = false;
      patch.bannedAt = null;
      patch.banReason = null;
      patch.bannedByAdminId = null;
    }

    if (action === "suspend_7d") {
      const until = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      patch.isSuspended = true;
      patch.suspendedUntil = until;
      patch.suspendReason = adminNote || null;
      patch.suspendedByAdminId = req.user._id;
    }

    if (action === "unsuspend") {
      patch.isSuspended = false;
      patch.suspendedUntil = null;
      patch.suspendReason = null;
      patch.suspendedByAdminId = null;
    }

    const updated = await User.findByIdAndUpdate(userId, { $set: patch }, { new: true })
      .select("_id isBanned bannedAt banReason isSuspended suspendedUntil suspendReason")
      .lean();

    const after = {
      isBanned: updated?.isBanned ?? null,
      isSuspended: updated?.isSuspended ?? null,
      suspendedUntil: updated?.suspendedUntil ?? null,
    };

    try {
      await AdminAuditLog.create({
        adminId: req.user._id,
        actionType: "USER_MODERATION",
        targetType: "user",
        targetId: String(userId),
        meta: {
          action,
          adminNote: adminNote || null,
          before,
          after,
          patch,
          ip: getClientIp(req),
          userAgent: (req.headers["user-agent"] || "").toString().slice(0, 500) || null,
        },
      });
    } catch (e) {
      console.warn("AdminAuditLog skipped:", e?.message || e);
    }

    return res.json({ status: "ok", data: updated });
  } catch (err) {
    console.error("Admin user moderation error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
