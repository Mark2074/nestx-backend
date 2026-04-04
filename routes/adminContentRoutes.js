const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const Post = require("../models/Post");
const AccountTrustRecord = require("../models/AccountTrustRecord");

// se già lo hai, bene. Se no, commenta la parte audit (ma consiglio di averlo)
const AdminAuditLog = require("../models/AdminAuditLog");

// --------------------------------------------------
// GET /api/admin/content/posts/queue
// query: mode=hidden|ai_hidden|all  q=   limit skip
// --------------------------------------------------
router.get("/content/posts/queue", auth, adminGuard, async (req, res) => {
  try {
    const mode = String(req.query.mode || "hidden").trim().toLowerCase();
    const q = String(req.query.q || "").trim();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 200));
    const skip = Math.max(0, parseInt(req.query.skip || "0", 10));

    const query = {};

    if (mode === "hidden") {
      query["moderation.status"] = "hidden";
    } else if (mode === "ai_hidden") {
      query["moderation.status"] = "under_review";
      query["moderation.hiddenBy"] = "ai";
    }

    if (q) {
      query.$or = [
        { text: { $regex: q, $options: "i" } },
        { tags: { $regex: q, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      Post.find(query).setOptions({ includeHidden: true })
        .sort({ "moderation.hiddenAt": -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("authorId", "displayName avatar accountType isPrivate")
        .lean(),
      Post.countDocuments(query).setOptions({ includeHidden: true })
    ]);

    return res.json({ status: "ok", total, limit, skip, items });
  } catch (err) {
    console.error("Admin posts queue error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// --------------------------------------------------
// PATCH /api/admin/content/posts/:id/hide
// body: { reason, severity: "grave"|"gravissimo", category? }
// --------------------------------------------------
router.patch("/content/posts/:id/hide", auth, adminGuard, async (req, res) => {
  try {
    const reason = req.body?.reason ? String(req.body.reason).trim() : null;
    const severity = String(req.body?.severity || "").trim().toLowerCase();
    const category = req.body?.category ? String(req.body.category).trim().toLowerCase() : null;

    if (!reason) return res.status(400).json({ status: "error", message: "reason required" });
    if (!["grave", "gravissimo"].includes(severity)) {
      return res.status(400).json({ status: "error", message: "severity required (grave|gravissimo)" });
    }

    const post = await Post.findById(req.params.id).select("authorId moderation").lean();
    if (!post) return res.status(404).json({ status: "error", message: "Post not found" });

    const now = new Date();

    const updated = await Post.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          "moderation.status": "hidden",
          "moderation.hiddenBy": "admin",
          "moderation.hiddenReason": reason,
          "moderation.hiddenSeverity": severity,
          "moderation.hiddenCategory": category,
          "moderation.hiddenAt": now,
          "moderation.hiddenByAdminId": req.user._id,
        },
      },
      { new: true }
    );

    // audit (se esiste)
    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: req.user._id,
        actionType: "HIDE_POST",
        targetType: "post",
        targetId: String(updated._id),
        meta: { severity, category, reason },
      });
    }

    // trust strike (solo per grave/gravissimo)
    if (post.authorId) {
      const inc = { confirmedTotal: 1 };
      if (severity === "gravissimo") inc.confirmedGravissimo = 1;
      else inc.confirmedGrave = 1;

      const trust = await AccountTrustRecord.findOneAndUpdate(
        { userId: post.authorId },
        {
          $inc: inc,
          $set: {
            lastConfirmedAt: now,
            lastConfirmedSeverity: severity,
            lastConfirmedCategory: category,
            updatedByAdminId: req.user._id,
          },
          $push: {
            lastEvents: {
              $each: [
                {
                  kind: "post_hidden",
                  postId: updated._id,
                  severity,
                  category,
                  at: now,
                  byAdminId: req.user._id,
                },
              ],
              $slice: -20,
            },
          },
        },
        { new: true, upsert: true }
      );

      // ricalcolo tier + tierScore (stessa logica che già usi nei report)
      let newTier = "OK";
      if (trust.confirmedGravissimo >= 1) newTier = "BLOCCO";
      else if (trust.confirmedTotal >= 3 || trust.confirmedGrave >= 2) newTier = "CRITICO";
      else if (trust.confirmedTotal >= 2 || trust.confirmedGrave >= 1) newTier = "ATTENZIONE";

      const tierScoreMap = { OK: 0, ATTENZIONE: 1, CRITICO: 2, BLOCCO: 3 };
      const newTierScore = tierScoreMap[newTier];

      if (newTier !== trust.tier || newTierScore !== trust.tierScore) {
        await AccountTrustRecord.updateOne(
          { _id: trust._id },
          { $set: { tier: newTier, tierScore: newTierScore } }
        );
      }
    }

    return res.json({ status: "ok", item: updated });
  } catch (err) {
    console.error("Admin hide post error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// --------------------------------------------------
// PATCH /api/admin/content/posts/:id/unhide
// body: { note? }
// --------------------------------------------------
router.patch("/content/posts/:id/unhide", auth, adminGuard, async (req, res) => {
  try {
    const note = req.body?.note ? String(req.body.note).trim() : null;

    const existing = await Post.findById(req.params.id).select("moderation").lean();
    if (!existing) return res.status(404).json({ status: "error", message: "Post not found" });

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
        },
      },
      { new: true }
    );

    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: req.user._id,
        actionType: "UNHIDE_POST",
        targetType: "post",
        targetId: String(updated._id),
        meta: { note: note || null },
      });
    }

    return res.json({ status: "ok", item: updated });
  } catch (err) {
    console.error("Admin unhide post error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
