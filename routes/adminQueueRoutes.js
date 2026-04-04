// routes/adminQueueRoutes.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const User = require("../models/user");
const Report = require("../models/Report");
const RefundRequest = require("../models/RefundRequest");
const Post = require("../models/Post");
const Event = require("../models/event");
const Comment = require("../models/Comment");
const LiveMessage = require("../models/LiveMessage");

/**
 * Pending Queue (Admin, Phase 1B)
 * GET /api/admin/pending
 * Query:
 *  - q: search (username/displayName/id)
 *  - category: verification|reports|economy|all (default all)
 *  - sort: priority|newest (default priority)
 *  - limit: default 200 (max 500)
 */

function envTrue(v) {
  return String(v || "").trim().toLowerCase() === "true";
}

function parseLimit(v, def = 200, min = 1, max = 500) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function normalizeStr(v) {
  return String(v || "").trim();
}

function safeRegex(v) {
  const s = normalizeStr(v);
  if (!s) return null;
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

// --- PRIORITY (backend is source of truth) ---
function calcPriority(type) {
  if (type.startsWith("critical_")) return "P0";
  if (type.startsWith("verification_")) return "P1";
  if (type.startsWith("report_")) return "P2";
  if (type.startsWith("economy_")) return "P3";
  if (type.startsWith("ops_")) return "P4";
  return "P4";
}

function sortByPriorityThenNewest(a, b) {
  const pr = (p) => {
    const m = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
    return m[p] ?? 9;
  };
  const pa = pr(a.priority);
  const pb = pr(b.priority);
  if (pa !== pb) return pa - pb;

  const ta = new Date(a.createdAt || 0).getTime();
  const tb = new Date(b.createdAt || 0).getTime();
  if (ta !== tb) return tb - ta;

  return String(b.id).localeCompare(String(a.id));
}

// Helper: build "links" for frontend navigation.
// Phase 1B: links must go to APP entities (profile/post/event), not admin placeholder routes.
// `open` remains an admin deep-link used to open the drawer.
function makeLinks({ open, userId, targetType, targetId }) {
  const user = userId ? `/app/profile/${userId}` : null;

  let target = null;
  if (targetType && targetId) {
    if (targetType === "profile" || targetType === "user") target = `/app/profile/${targetId}`;
    else if (targetType === "post") target = `/app/post/${targetId}`;
    // Phase 1B: event target NOT clickable until APP event route exists
    else if (targetType === "event") target = null;
  }

  return {
    open: open || null,
    user,
    target,
  };
}

router.get("/pending", auth, adminGuard, async (req, res) => {
  try {
    const q = normalizeStr(req.query.q);
    const category = normalizeStr(req.query.category || "all").toLowerCase();
    const sort = normalizeStr(req.query.sort || "priority").toLowerCase();
    const limit = parseLimit(req.query.limit, 200);

    const qRx = safeRegex(q);

    const wantVerification = category === "all" || category === "verification";
    const wantReports = category === "all" || category === "reports";
    const wantEconomy = category === "all" || category === "economy";

    const items = [];

    // ---- VERIFICATIONS ----
    if (wantVerification) {
      const vQuery = {
        $or: [{ verificationStatus: "pending" }, { verificationTotemStatus: "pending" }],
      };

      if (qRx) {
        const maybeId = q.length === 24 ? q : null;
        vQuery.$and = [
          {
            $or: [
              { displayName: { $regex: qRx } },
              { username: { $regex: qRx } },
              ...(maybeId ? [{ _id: maybeId }] : []),
            ],
          },
        ];
      }

      const users = await User.find(vQuery)
        .select("_id username displayName createdAt updatedAt verificationStatus verificationTotemStatus")
        .sort({ updatedAt: -1, _id: -1 })
        .limit(limit)
        .lean();

      for (const u of users) {
        const userId = String(u._id);
        const userLabel = u.username ? `@${u.username}` : (u.displayName || userId);

        if (u.verificationStatus === "pending") {
          const type = "verification_pending";
          items.push({
            id: userId,
            type,
            priority: calcPriority(type),
            subject: `user: ${userLabel}`,
            createdAt: u.updatedAt || u.createdAt || new Date(),
            status: "pending",
            meta: { verificationKind: "profile", userId },
            actions: {
              approve: { method: "PATCH", path: `/admin/verifications/${userId}/profile/approve` },
              reject: { method: "PATCH", path: `/admin/verifications/${userId}/profile/reject` },
            },
            links: makeLinks({
              open: `/admin/pending?type=verification&userId=${userId}&kind=profile`,
              userId,
            }),
          });
        }

        if (u.verificationTotemStatus === "pending") {
          const type = "verification_pending";
          items.push({
            id: `totem:${userId}`,
            type,
            priority: calcPriority(type),
            subject: `user: ${userLabel} (totem)`,
            createdAt: u.updatedAt || u.createdAt || new Date(),
            status: "pending",
            meta: { verificationKind: "totem", userId },
            actions: {
              approve: { method: "PATCH", path: `/admin/verifications/${userId}/totem/approve` },
              reject: { method: "PATCH", path: `/admin/verifications/${userId}/totem/reject` },
            },
            links: makeLinks({
              open: `/admin/pending?type=verification&userId=${userId}&kind=totem`,
              userId,
            }),
          });
        }
      }
    }

    // ---- REPORTS ----
    if (wantReports) {
      const rQuery = {
        status: "pending",
        targetType: { $in: ["user", "post", "event", "comment", "live_message"] },
      };

      if (qRx) {
        const maybeId = q.length === 24 ? q : null;
        rQuery.$or = [
          { reason: { $regex: qRx } },
          { note: { $regex: qRx } },
          ...(maybeId ? [{ _id: maybeId }, { targetId: maybeId }] : []),
        ];
      }

      const reports = await Report.find(rQuery)
        .select("_id targetType targetId reporterId createdAt updatedAt status reason note contextType contextId severity")
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .lean();

      const reporterIds = Array.from(
        new Set(
          (reports || [])
            .map((x) => (x && x.reporterId ? String(x.reporterId) : null))
            .filter(Boolean)
        )
      );

      const reporterMap = new Map();
      if (reporterIds.length > 0) {
        const reporterUsers = await User.find({ _id: { $in: reporterIds } })
          .select("_id username displayName")
          .lean();
        for (const u of reporterUsers) {
          reporterMap.set(String(u._id), u);
        }
      }

      for (const r of reports) {
        const reportId = String(r._id);
        const targetId = String(r.targetId);

        const ctxType = r.contextType ? String(r.contextType) : null;
        const ctxId = r.contextId ? String(r.contextId) : null;

        // type
        let type = "report_post";

        if (ctxType === "live" && ctxId) type = "report_live";
        else if (r.targetType === "user") type = "report_profile";
        else if (r.targetType === "post") type = "report_post";
        else if (r.targetType === "event") type = "report_event";
        else if (r.targetType === "comment") type = "report_comment";
        else if (r.targetType === "live_message") type = "report_live_message";

        // subject
        let subject = "";

        if (type === "report_live") subject = `live: ${ctxId}`;
        else if (r.targetType === "user") subject = `profile: ${targetId}`;
        else if (r.targetType === "post") subject = `post: ${targetId}`;
        else if (r.targetType === "event") subject = `event: ${targetId}`;
        else if (r.targetType === "comment") subject = `comment: ${targetId}`;
        else if (r.targetType === "live_message") subject = `live_message: ${targetId}`;
        else subject = `${r.targetType}: ${targetId}`;

        const rep = reporterMap.get(String(r.reporterId)) || null;
        const reporterUsername = rep?.username || rep?.displayName || null;

        // links: per live NON usare makeLinks() target, perché makeLinks non gestisce live
        const links = makeLinks({
          open: `/admin/pending?type=report&id=${reportId}`,
          userId: r.reporterId ? String(r.reporterId) : null,
          targetType: r.targetType === "user" ? "profile" : r.targetType,
          targetId,
        });

        // se live: aggiungi deep link admin event in links.target (così il FE può aprire dal drawer)
        if (type === "report_live" && ctxId) {
          links.target = `/admin/events/${ctxId}`; // se non esiste ancora la route admin, metti null
        }

        items.push({
          id: reportId,
          type,
          priority: r.severity || "P4",
          subject,
          createdAt: r.createdAt || r.updatedAt || new Date(),
          status: r.status || "pending",
          meta: {
            reportId,
            targetType: r.targetType,
            targetId,
            reporterUserId: r.reporterId ? String(r.reporterId) : null,
            reporterUsername,

            // ✅ report payload
            reason: r.reason || "",
            note: r.note || "",
            reasonText: String(r.note || "").trim() || String(r.reason || "").trim(),

            // ✅ context
            contextType: ctxType,
            contextId: ctxId,
          },
          actions: {
            reviewed: { method: "PATCH", path: `/admin/reports/${reportId}`, body: { status: "reviewed" } },
            hide: { method: "PATCH", path: `/admin/reports/${reportId}`, body: { status: "hidden" } },
            dismiss: { method: "PATCH", path: `/admin/reports/${reportId}`, body: { status: "dismissed" } },
            actioned: { method: "PATCH", path: `/admin/reports/${reportId}`, body: { status: "actioned" } },
          },
          links,
        });
      }
    }

    // ---- ECONOMY (Manual Refund Requests) ----
    if (wantEconomy) {
      // Manual refunds must appear in Pending regardless of ECONOMY_ENABLED flag
      // because they are an admin operational queue.

      const rrQuery = { status: "pending" };

      if (qRx) {
        const maybeId = q.length === 24 ? q : null;

        // try match requester by username/displayName
        const matchedUsers = await User.find({
          $or: [{ username: { $regex: qRx } }, { displayName: { $regex: qRx } }, ...(maybeId ? [{ _id: maybeId }] : [])],
        })
          .select("_id")
          .limit(200)
          .lean();

        const matchedUserIds = (matchedUsers || []).map((u) => u._id);

        rrQuery.$or = [
          ...(maybeId ? [{ _id: maybeId }] : []),
          { reasonText: { $regex: qRx } },
          { referenceId: { $regex: qRx } },
          ...(matchedUserIds.length ? [{ requesterUserId: { $in: matchedUserIds } }] : []),
        ];
      }

      const refundRequests = await RefundRequest.find(rrQuery)
        .select("_id requesterUserId amountTokens reasonText referenceType referenceId attachments status createdAt updatedAt")
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .populate("requesterUserId", "_id username displayName")
        .lean();

      for (const rr of refundRequests) {
        const requestId = String(rr._id);

        const requester = rr.requesterUserId || null;
        const requesterId = requester?._id ? String(requester._id) : null;

        const requesterLabel =
          (requester?.username ? `@${requester.username}` : null) || requester?.displayName || requesterId || "unknown";

        const type = "economy_refund_request";

        items.push({
          id: requestId,
          type,
          priority: calcPriority(type),
          subject: `refund: ${requesterLabel}`,
          createdAt: rr.createdAt || rr.updatedAt || new Date(),
          status: rr.status || "pending",
          meta: {
            requestId,
            requesterUserId: requesterId,
            requesterUsername: requester?.username || null,
            requesterDisplayName: requester?.displayName || null,

            amountTokens: rr.amountTokens ?? null,
            reasonText: rr.reasonText || "",
            referenceType: rr.referenceType || "other",
            referenceId: rr.referenceId || "",
            attachments: Array.isArray(rr.attachments) ? rr.attachments : [],
          },
          actions: {
            approve: { method: "POST", path: `/admin/economy/manual-refunds/${requestId}/approve` },
            reject: { method: "POST", path: `/admin/economy/manual-refunds/${requestId}/reject` },
          },
          links: makeLinks({
            open: `/admin/pending?type=economy&id=${requestId}`,
            userId: requesterId,
          }),
        });
      }
    }

    // sort
    if (sort === "newest") {
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else {
      items.sort(sortByPriorityThenNewest);
    }

    const counters = {
      total: items.length,

      // priorità reale
      critical: items.filter((x) => x.priority === "P0").length,

      // categorie reali
      verification: items.filter((x) => String(x.type || "").startsWith("verification_")).length,
      reports: items.filter((x) => String(x.type || "").startsWith("report_")).length,
      economy: items.filter((x) => String(x.type || "").startsWith("economy_")).length,
    };

    return res.status(200).json({ status: "ok", counters, items });
  } catch (err) {
    console.error("Admin pending error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while retrieving pending queue",
    });
  }
});

// ---------------------------------------------------------------------------
// Report detail for Pending drawer (Phase 1B)
// GET /api/admin/reports/:reportId/detail
// Returns: reporter info, target info, user message (free-text)
// ---------------------------------------------------------------------------
/*router.get("/reports/:reportId/detail", auth, adminGuard, async (req, res) => {
  try {
    const { reportId } = req.params;
    if (!reportId || String(reportId).length < 10) {
      return res.status(400).json({ status: "error", message: "Invalid report ID" });
    }

    const r = await Report.findById(reportId)
      .select("_id targetType targetId targetOwnerId reporterId createdAt updatedAt status reason note contextType contextId confirmedSeverity confirmedCategory adminNote reviewedBy reviewedAt")
      .lean();
    if (!r) {
      return res.status(404).json({ status: "error", message: "Report not found" });
    }

    const reporter = r.reporterId
      ? await User.findById(r.reporterId).select("_id username displayName").lean()
      : null;

    let targetOwnerId = r.targetOwnerId || null;

    if (!targetOwnerId && r.targetType && r.targetId) {
      if (r.targetType === "user") {
        targetOwnerId = r.targetId;
      } else if (r.targetType === "post") {
        const p = await Post.findById(r.targetId).select("authorId").lean();
        targetOwnerId = p?.authorId || null;
      } else if (r.targetType === "event") {
        const e = await Event.findById(r.targetId).select("creatorId").lean();
        targetOwnerId = e?.creatorId || null;
      }

      // opzionale: cache sul report per le prossime volte
      if (targetOwnerId) {
        await Report.updateOne({ _id: r._id }, { $set: { targetOwnerId } });
      }
    }

    return res.json({
      status: "ok",
      data: {
        reportId: String(r._id),
        status: r.status || "pending",
        createdAt: r.createdAt || r.updatedAt || null,
        targetType: r.targetType || null,
        targetId: r.targetId ? String(r.targetId) : null,
        reporter: reporter
          ? { userId: String(reporter._id), username: reporter.username || null, displayName: reporter.displayName || null }
          : null,
        reason: r.reason || "",
        userMessage: r.note || "",
        targetOwnerId: targetOwnerId ? String(targetOwnerId) : null,
        contextType: r.contextType || null,
        contextId: r.contextId ? String(r.contextId) : null,
      },
    });
  } catch (err) {
    console.error("Admin report detail error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});
*/

// ---------------------------------------------------------------------------
// Admin target preview (Phase 1B)
// GET /api/admin/preview?type=post|comment|live_message&targetId=...
// ---------------------------------------------------------------------------
router.get("/preview", auth, adminGuard, async (req, res) => {
  try {
    const type = String(req.query?.type || "").trim().toLowerCase();
    const targetId = String(req.query?.targetId || "").trim();

    if (!type || !targetId) {
      return res.status(400).json({
        status: "error",
        message: "Missing type or targetId",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid targetId",
      });
    }

    function pickUserId(obj) {
      if (!obj) return null;
      return (
        obj.userId ||
        obj.authorId ||
        obj.createdBy ||
        obj.ownerId ||
        obj.senderId ||
        null
      );
    }

    async function hydrateUser(userId) {
      if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return null;
      const u = await User.findById(userId).select("_id username displayName avatar").lean();
      if (!u) return null;
      return {
        userId: String(u._id),
        username: u.username || null,
        displayName: u.displayName || null,
        avatar: u.avatar || null,
      };
    }

    let data = null;

    if (type === "post") {
      const post = await Post.findById(targetId).lean();

      if (post) {
        const postAuthor = await hydrateUser(pickUserId(post));

        data = {
          post,
          postAuthor,
        };
      }
    } else if (type === "comment") {
      const comment = await Comment.findById(targetId).lean();

      if (comment) {
        const postId =
          comment.postId ||
          comment.post ||
          comment.parentPostId ||
          null;

        const post = postId ? await Post.findById(postId).lean() : null;

        const commentAuthor = await hydrateUser(pickUserId(comment));
        const postAuthor = await hydrateUser(pickUserId(post));

        data = {
          comment,
          post,
          commentAuthor,
          postAuthor,
        };
      }
    } else if (type === "live_message") {
      const message = await LiveMessage.findById(targetId).lean();

      if (message) {
        const eventId =
          message.eventId ||
          message.liveId ||
          message.roomId ||
          null;

        const event = eventId ? await Event.findById(eventId).lean() : null;
        const messageAuthor = await hydrateUser(pickUserId(message));

        data = {
          message,
          event,
          messageAuthor,
        };
      }
    } else {
      return res.status(400).json({
        status: "error",
        message: "Unsupported preview type",
      });
    }

    if (!data) {
      return res.status(404).json({
        status: "error",
        message: "Target not found",
      });
    }

    return res.json({
      status: "ok",
      data,
    });
  } catch (err) {
    console.error("Admin preview error:", err);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Internal error",
    });
  }
});

// ---------------------------------------------------------------------------
// Legacy endpoints kept (used by other admin pages / dashboard)
// ---------------------------------------------------------------------------

function buildReportQueueQuery() {
  return { status: { $in: ["pending"] } };
}

async function fetchBucket(targetValue, limit) {
  const query = { ...buildReportQueueQuery(), targetType: targetValue };

  const [count, items] = await Promise.all([
    Report.countDocuments(query),
    Report.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).lean(),
  ]);

  return { count, items };
}

router.get("/queue", auth, adminGuard, async (req, res) => {
  try {
    const rawLimit = Number(req.query.limitPerBucket || 20);
    const limitPerBucket = Math.min(Math.max(rawLimit, 1), 100);

    const [userBucket, postBucket, eventBucket] = await Promise.all([
      fetchBucket("user", limitPerBucket),
      fetchBucket("post", limitPerBucket),
      fetchBucket("event", limitPerBucket),
    ]);

    return res.status(200).json({
      status: "ok",
      limitPerBucket,
      reports: {
        user: userBucket,
        event: eventBucket,
        post: postBucket,
        totalPending:
          (userBucket.count || 0) + (eventBucket.count || 0) + (postBucket.count || 0),
      },
    });
  } catch (err) {
    console.error("Admin queue error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error while retrieving the admin queue",
    });
  }
});

router.get("/queue/users", auth, adminGuard, async (req, res) => {
  try {
    const minTierScore = Number.isFinite(Number(req.query.minTierScore))
      ? Number(req.query.minTierScore)
      : 1;

    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 200));
    const skip = Math.max(0, parseInt(req.query.skip || "0", 10));

    const query = {
      tierScore: { $gte: minTierScore },
    };

    const [items, total] = await Promise.all([
      AccountTrustRecord.find(query)
        .sort({ tierScore: -1, lastConfirmedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "displayName avatar accountType isCreator isVip")
        .lean(),
      AccountTrustRecord.countDocuments(query),
    ]);

    return res.json({
      status: "ok",
      total,
      limit,
      skip,
      items,
    });
  } catch (err) {
    console.error("Admin queue users error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
