const express = require("express");
const mongoose = require("mongoose");
const authMiddleware = require("../middleware/authMiddleware");
const Report = require("../models/Report");
const Notification = require("../models/notification");
const Post = require("../models/Post");
const Comment = require("../models/Comment");
const Event = require("../models/event");

const router = express.Router();

const REASON_LABELS = {
  minor_involved: "Minor involved",
  illegal_content: "Illegal content",
  violent_or_gore_content: "Violent or gore content",
  violent_extremism_or_propaganda: "Violent extremism or propaganda",
  harassment_or_threats: "Harassment or threats",
  spam_or_scam: "Spam or scam",
  impersonation_or_fake: "Impersonation or fake",
  other: "Other",
};

function classifyReportReason(targetType, reasonCode) {
  const code = String(reasonCode || "").trim();

  const contentMap = {
    minor_involved: { severity: "P0", priorityScore: 0, shouldAutoHideContent: true, category: "minor_involved" },
    illegal_content: { severity: "P0", priorityScore: 0, shouldAutoHideContent: true, category: "illegal_content" },
    violent_extremism_or_propaganda: { severity: "P0", priorityScore: 0, shouldAutoHideContent: true, category: "violent_extremism_or_propaganda" },
    violent_or_gore_content: { severity: "P1", priorityScore: 1, shouldAutoHideContent: true, category: "violent_or_gore_content" },
    harassment_or_threats: { severity: "P1", priorityScore: 1, shouldAutoHideContent: true, category: "harassment_or_threats" },
    impersonation_or_fake: { severity: "P2", priorityScore: 2, shouldAutoHideContent: false, category: "impersonation_or_fake" },
    spam_or_scam: { severity: "P3", priorityScore: 3, shouldAutoHideContent: false, category: "spam_or_scam" },
    other: { severity: "P4", priorityScore: 4, shouldAutoHideContent: false, category: "other" },
  };

  const userMap = {
    minor_involved: { severity: "P0", priorityScore: 0, shouldAutoHideContent: false, category: "minor_involved" },
    illegal_content: { severity: "P0", priorityScore: 0, shouldAutoHideContent: false, category: "illegal_content" },
    violent_extremism_or_propaganda: { severity: "P0", priorityScore: 0, shouldAutoHideContent: false, category: "violent_extremism_or_propaganda" },
    violent_or_gore_content: { severity: "P1", priorityScore: 1, shouldAutoHideContent: false, category: "violent_or_gore_content" },
    harassment_or_threats: { severity: "P2", priorityScore: 2, shouldAutoHideContent: false, category: "harassment_or_threats" },
    impersonation_or_fake: { severity: "P1", priorityScore: 1, shouldAutoHideContent: false, category: "impersonation_or_fake" },
    spam_or_scam: { severity: "P2", priorityScore: 2, shouldAutoHideContent: false, category: "spam_or_scam" },
    other: { severity: "P4", priorityScore: 4, shouldAutoHideContent: false, category: "other" },
  };

  const map = targetType === "user" ? userMap : contentMap;
  return map[code] || null;
}

async function applyAutoHideToTarget({ targetType, targetId, reasonCode, severity, category }) {
  const hiddenPatch = {
    "moderation.status": "under_review",
    "moderation.hiddenBy": "system",
    "moderation.hiddenReason": reasonCode,
    "moderation.hiddenSeverity": severity,
    "moderation.hiddenCategory": category,
    "moderation.hiddenAt": new Date(),
    "moderation.isDeleted": false,
  };

  if (targetType === "post") {
    await Post.updateOne(
      { _id: targetId, "moderation.isDeleted": { $ne: true } },
      { $set: hiddenPatch }
    );
    return;
  }

  if (targetType === "comment") {
    await Comment.updateOne(
      { _id: targetId, isDeleted: { $ne: true } },
      { $set: hiddenPatch }
    );
    return;
  }

  // live_message da chiudere quando mi passi il model reale
}

router.post("/", authMiddleware, async (req, res) => {
  try {
    const { targetType, targetId, reasonCode, note, contextType, contextId } = req.body;

    if (!targetType || !targetId || !reasonCode) {
      return res.status(400).json({
        status: "error",
        code: "MISSING_FIELDS",
        message: "Missing required fields",
      });
    }

    const allowedTargetTypes = ["user", "post", "event", "comment", "live_message"];
    if (!allowedTargetTypes.includes(String(targetType))) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_TARGET_TYPE",
        message: "Invalid targetType",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(String(targetId))) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_TARGET_ID",
        message: "Invalid targetId",
      });
    }

    const ctxType = contextType ? String(contextType).trim() : null;
    const ctxId = contextId ? String(contextId).trim() : null;

    if (ctxType) {
      if (ctxType !== "live") {
        return res.status(400).json({
          status: "error",
          code: "INVALID_CONTEXT_TYPE",
          message: "Invalid contextType",
        });
      }
      if (!ctxId || !mongoose.Types.ObjectId.isValid(ctxId)) {
        return res.status(400).json({
          status: "error",
          code: "INVALID_CONTEXT_ID",
          message: "Invalid contextId",
        });
      }
    }

    if (targetType === "user" && ctxType === "live" && !ctxId) {
      return res.status(400).json({
        status: "error",
        code: "MISSING_FIELDS",
        message: "Missing required fields",
      });
    }

    const classification = classifyReportReason(String(targetType), String(reasonCode));
    if (!classification) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_REASON_CODE",
        message: "Invalid reasonCode",
      });
    }

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentCount = await Report.countDocuments({
      reporterId: req.user._id,
      createdAt: { $gte: tenMinAgo },
    });

    if (recentCount >= 5) {
      return res.status(429).json({
        status: "error",
        code: "RATE_LIMITED",
        message: "Too many reports, try again later",
      });
    }

    const filter = {
      reporterId: req.user._id,
      targetType: String(targetType),
      targetId: new mongoose.Types.ObjectId(String(targetId)),
      contextType: ctxType || null,
      contextId: ctxType ? new mongoose.Types.ObjectId(String(ctxId)) : null,
      reasonCode: String(reasonCode),
    };

    const report = await Report.findOneAndUpdate(
      filter,
      {
        $set: {
          targetType: String(targetType),
          targetId: new mongoose.Types.ObjectId(String(targetId)),
          reporterId: req.user._id,
          source: "user",

          reasonCode: String(reasonCode),
          reason: REASON_LABELS[String(reasonCode)] || String(reasonCode),
          note: note ? String(note).trim() : null,

          severity: classification.severity,
          priorityScore: classification.priorityScore,
          status: "pending",

          confirmedSeverity: null,
          confirmedCategory: null,

          contextType: ctxType || null,
          contextId: ctxType ? new mongoose.Types.ObjectId(String(ctxId)) : null,

          targetOwnerId: String(targetType) === "user"
            ? new mongoose.Types.ObjectId(String(targetId))
            : null,
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    if (
      ["post", "comment", "live_message"].includes(String(targetType)) &&
      classification.shouldAutoHideContent
    ) {
      await applyAutoHideToTarget({
        targetType: String(targetType),
        targetId: new mongoose.Types.ObjectId(String(targetId)),
        reasonCode: String(reasonCode),
        severity: classification.severity,
        category: classification.category,
      });
    }

    try {
      await Notification.create({
        userId: null,
        actorId: req.user._id,
        type: "ADMIN_REPORT_PENDING",
        targetType: String(targetType),
        targetId: String(targetId),
        message: `New report (${targetType}${ctxType === "live" ? " in live" : ""}): ${REASON_LABELS[String(reasonCode)] || String(reasonCode)}`,
        data: {
          reportId: String(report._id),
          reporterId: String(req.user._id),
          targetType: String(targetType),
          targetId: String(targetId),
          reasonCode: String(reasonCode),
          reason: REASON_LABELS[String(reasonCode)] || String(reasonCode),
          note: note ? String(note) : "",
          contextType: ctxType || "",
          contextId: ctxId ? String(ctxId) : "",
          severity: classification.severity,
          priorityScore: classification.priorityScore,
        },
        isPersistent: false,
        dedupeKey: `admin:report:${report._id}:pending`,
      });
    } catch (e) {
      if (e?.code !== 11000) console.error("Admin notification REPORT pending error:", e);
    }

    return res.json({ status: "ok", message: "Report submitted" });
  } catch (err) {
    console.error("REPORT /api/report error:", err);

    if (err?.name === "ValidationError") {
      return res.status(400).json({ status: "error", code: "VALIDATION_ERROR", message: err.message });
    }
    if (err?.name === "CastError") {
      return res.status(400).json({ status: "error", code: "CAST_ERROR", message: err.message });
    }
    if (err?.code === 11000) {
      return res.status(200).json({ status: "ok", message: "Report submitted", dedup: true });
    }

    return res.status(500).json({ status: "error", code: "INTERNAL", message: "Internal server error" });
  }
});

router.get("/recent-lives/:userId", authMiddleware, async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_USER_ID",
        message: "Invalid userId",
      });
    }

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const rawLimit = Number(req.query.limit || 5);
    const limit = Math.min(Math.max(rawLimit, 1), 10);

    const recentLives = await Event.aggregate([
      {
        $match: {
          creatorId: new mongoose.Types.ObjectId(userId),
          $or: [
            { endedAt: { $gte: sevenDaysAgo } },
            { actualLiveEndTime: { $gte: sevenDaysAgo } },
            { "live.endedAt": { $gte: sevenDaysAgo } },
          ],
        },
      },
      {
        $addFields: {
          effectiveStartAt: {
            $ifNull: [
              "$startedAt",
              {
                $ifNull: [
                  "$actualLiveStartTime",
                  {
                    $ifNull: ["$live.startedAt", "$startTime"],
                  },
                ],
              },
            ],
          },
          effectiveEndAt: {
            $ifNull: [
              "$endedAt",
              {
                $ifNull: [
                  "$actualLiveEndTime",
                  {
                    $ifNull: ["$live.endedAt", "$updatedAt"],
                  },
                ],
              },
            ],
          },
          liveType: {
            $cond: [
              {
                $or: [
                  { $eq: ["$accessScope", "private"] },
                  { $eq: ["$privateSession.isEnabled", true] },
                ],
              },
              "private",
              "public",
            ],
          },
        },
      },
      {
        $match: {
          effectiveEndAt: { $gte: sevenDaysAgo },
        },
      },
      {
        $sort: {
          effectiveEndAt: -1,
          _id: -1,
        },
      },
      {
        $limit: limit,
      },
      {
        $project: {
          _id: 1,
          title: 1,
          startAt: "$effectiveStartAt",
          endAt: "$effectiveEndAt",
          type: "$liveType",
        },
      },
    ]);

    return res.json({
      status: "ok",
      items: recentLives.map((item) => ({
        eventId: String(item._id),
        title: item.title || "",
        startAt: item.startAt || null,
        endAt: item.endAt || null,
        type: item.type || "public",
      })),
    });
  } catch (err) {
    console.error("REPORT recent-lives error:", err);
    return res.status(500).json({
      status: "error",
      code: "INTERNAL",
      message: "Internal server error",
    });
  }
});

module.exports = router;
