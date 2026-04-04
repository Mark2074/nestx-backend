const express = require("express");
const router = express.Router();

const internalServiceGuard = require("../middleware/internalServiceGuard");

const mongoose = require("mongoose");
const Report = require("../models/Report");
const Notification = require("../models/notification");

const Post = require("../models/Post");

// se ce l’hai bene, se no commenta i 2 blocchi audit
const AdminAuditLog = require("../models/AdminAuditLog");

/**
 * POST /api/ai/moderation/posts/:id/hide
 * Headers: x-internal-key: <INTERNAL_SERVICE_KEY>
 * Body: { severity: "grave"|"gravissimo", category?, reason?, score?, labels?[] }
 */
router.post("/moderation/posts/:id/hide", internalServiceGuard, async (req, res) => {
  try {
    const severity = String(req.body?.severity || "").trim().toLowerCase();
    const category = req.body?.category ? String(req.body.category).trim().toLowerCase() : null;
    const reason = req.body?.reason ? String(req.body.reason).trim() : "ai_flagged";
    const score = Number.isFinite(Number(req.body?.score)) ? Number(req.body.score) : 0;
    const labels = Array.isArray(req.body?.labels) ? req.body.labels.map(String) : [];

    if (!["grave", "gravissimo"].includes(severity)) {
      return res.status(400).json({ status: "error", message: "severity required (grave|gravissimo)" });
    }

    const now = new Date();

    const updated = await Post.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          "moderation.status": "under_review",
          "moderation.hiddenBy": "ai",
          "moderation.hiddenReason": reason,
          "moderation.hiddenSeverity": severity,
          "moderation.hiddenCategory": category,
          "moderation.hiddenAt": now,
          "moderation.hiddenByAdminId": null,

          "moderation.ai.flagged": true,
          "moderation.ai.score": score,
          "moderation.ai.labels": labels,
        },
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }

    const mappedReason = severity === "gravissimo" ? "ILLEGAL_CONTENT" : "INAPPROPRIATE_CONTENT";
    const mappedPriority = severity === "gravissimo" ? "P0" : "P1";
    const mappedPriorityScore = severity === "gravissimo" ? 0 : 1;

    let aiReport = null;

    try {
      aiReport = await Report.findOneAndUpdate(
        {
          source: "ai",
          targetType: "post",
          targetId: new mongoose.Types.ObjectId(String(updated._id)),
          status: { $in: ["pending", "hidden"] },
        },
        {
          $set: {
            reporterId: null,
            source: "ai",
            targetType: "post",
            targetId: new mongoose.Types.ObjectId(String(updated._id)),
            reason: mappedReason,
            note: reason || "ai_flagged",
            severity: mappedPriority,
            status: "pending",
            confirmedSeverity: null,
            confirmedCategory: null,
            targetOwnerId: updated.authorId || null,
            priorityScore: mappedPriorityScore,
            aiReview: {
              score,
              labels,
              suggestedSeverity: severity,
            },
          },
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );
    } catch (e) {
      console.error("AI report upsert error:", e);
    }

    if (aiReport) {
      try {
        await Notification.create({
          userId: null,
          actorId: null,
          type: "ADMIN_REPORT_PENDING",
          targetType: "report",
          targetId: aiReport._id,
          message: `AI flagged post (${severity})`,
          data: {
            reportId: String(aiReport._id),
            source: "ai",
            targetType: "post",
            targetId: String(updated._id),
            suggestedSeverity: severity,
            score,
            labels,
            reason: reason || "ai_flagged",
          },
          isPersistent: false,
          dedupeKey: `admin:report:${aiReport._id}:pending`,
        });
      } catch (e) {
        if (e?.code !== 11000) {
          console.error("AI admin notification error:", e);
        }
      }
    }

    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: null,
        actionType: "AI_HIDE_POST",
        targetType: "post",
        targetId: String(updated._id),
        meta: { severity, category, reason, score, labels },
      });
    }

    return res.json({ status: "ok", item: updated });
  } catch (err) {
    console.error("AI hide post error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * POST /api/ai/moderation/posts/:id/unhide
 * (raramente serve, ma utile per rollback)
 */
router.post("/moderation/posts/:id/unhide", internalServiceGuard, async (req, res) => {
  try {
    const updated = await Post.findByIdAndUpdate(
      req.params.id,
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
      },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }

    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: null,
        actionType: "AI_UNHIDE_POST",
        targetType: "post",
        targetId: String(updated._id),
        meta: {},
      });
    }

    return res.json({ status: "ok", item: updated });
  } catch (err) {
    console.error("AI unhide post error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
