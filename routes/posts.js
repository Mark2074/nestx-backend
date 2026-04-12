const express = require('express');
const mongoose = require('mongoose');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const PostLike = require('../models/PostLike');
const auth = require('../middleware/authMiddleware'); // adatta il percorso se serve
const getMutedUserIds = require("../utils/getMutedUserIds");
const Follow = require("../models/Follow"); // occhio al path/nome file
const Event = require("../models/event");
const User = require("../models/user");
const Notification = require("../models/notification"); // usa lo STESSO path che usi nelle notif follow
const MutedUser = require("../models/MutedUser");
const Block = require("../models/block");
const { isUserBlockedEitherSide } = require("../utils/blockUtils");
const ActionAuditLog = require("../models/ActionAuditLog");
const AdminAuditLog = require("../models/AdminAuditLog");
const PollVote = require("../models/PollVote");
const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");
const {
  uploadBufferToR2,
  buildObjectKey,
  makeScopedFilename,
} = require("../services/r2MediaService");
const { detectContentSafety } = require("../utils/contentSafety");
const { analyzeTextModeration } = require("../services/moderationService");
const Report = require("../models/Report");

const { execFile } = require("child_process");
const ffprobePath = require("ffprobe-static")?.path;

function ffprobeDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    if (!ffprobePath) return reject(new Error("FFPROBE_NOT_AVAILABLE"));

    execFile(
      ffprobePath,
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      (err, stdout) => {
        if (err) return reject(err);
        const n = Number.parseFloat(String(stdout || "").trim());
        if (!Number.isFinite(n)) return reject(new Error("FFPROBE_INVALID_DURATION"));
        resolve(n);
      }
    );
  });
}

function writeTempBufferToFile(buffer, originalName = "upload.bin") {
  const ext = path.extname(originalName || "") || ".bin";
  const tmpFile = path.join(os.tmpdir(), `nestx_${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
  fs.writeFileSync(tmpFile, buffer);
  return tmpFile;
}

function deleteUploadedFiles(files) {
  for (const f of files || []) {
    try {
      if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    } catch (_) {}
  }
}

const router = express.Router();

const POST_RATE_LIMIT_MS = 30 * 1000;
const COMMENT_RATE_LIMIT_MS = 5 * 1000;

const lastPostAt = new Map();     // key: userId -> timestamp
const lastCommentAt = new Map();  // key: userId -> timestamp

function canCreatePost(userId) {
  const key = String(userId);
  const now = Date.now();
  const last = lastPostAt.get(key) || 0;

  if (now - last < POST_RATE_LIMIT_MS) {
    return {
      ok: false,
      retryAfterMs: POST_RATE_LIMIT_MS - (now - last),
    };
  }

  lastPostAt.set(key, now);
  return { ok: true, retryAfterMs: 0 };
}

function canCreateComment(userId) {
  const key = String(userId);
  const now = Date.now();
  const last = lastCommentAt.get(key) || 0;

  if (now - last < COMMENT_RATE_LIMIT_MS) {
    return {
      ok: false,
      retryAfterMs: COMMENT_RATE_LIMIT_MS - (now - last),
    };
  }

  lastCommentAt.set(key, now);
  return { ok: true, retryAfterMs: 0 };
}

function inferAISuggestedSeverity(aiModeration) {
  const labels = Array.isArray(aiModeration?.labels) ? aiModeration.labels.map((x) => String(x).toLowerCase()) : [];
  const reason = String(aiModeration?.reason || "").toLowerCase();

  const gravissimoSignals = ["csam", "child", "minor", "underage", "pedo", "pedoph", "sexual_minor"];

  const hasGravissimoSignal =
    labels.some((l) => gravissimoSignals.some((k) => l.includes(k))) ||
    gravissimoSignals.some((k) => reason.includes(k));

  if (hasGravissimoSignal) return "gravissimo";
  if (aiModeration?.flagged) return "grave";
  return null;
}

function inferAICategory(aiModeration) {
  const labels = Array.isArray(aiModeration?.labels) ? aiModeration.labels.map((x) => String(x).toLowerCase()) : [];
  const reason = String(aiModeration?.reason || "").toLowerCase();

  if (
    labels.some((l) => l.includes("csam") || l.includes("minor") || l.includes("underage") || l.includes("child")) ||
    reason.includes("csam") ||
    reason.includes("minor") ||
    reason.includes("underage") ||
    reason.includes("child")
  ) {
    return "csam";
  }

  return labels[0] || "ai_flagged";
}

async function createOrUpdateAIReport({
  targetType,
  targetId,
  targetOwnerId,
  reason,
  severity,
  category,
  score,
  labels,
}) {
  const reasonCode = severity === "gravissimo" ? "illegal_content" : "violent_or_gore_content";
  const mappedPriority = severity === "gravissimo" ? "P0" : "P1";
  const mappedPriorityScore = severity === "gravissimo" ? 0 : 1;

  const report = await Report.findOneAndUpdate(
    {
      source: "ai",
      targetType,
      targetId: new mongoose.Types.ObjectId(String(targetId)),
      status: { $in: ["pending", "hidden"] },
    },
    {
      $set: {
        reporterId: null,
        source: "ai",
        targetType,
        targetId: new mongoose.Types.ObjectId(String(targetId)),
        reasonCode,
        reason: reasonCode === "illegal_content" ? "Illegal content" : "Violent or gore content",
        note: reason || "ai_flagged",
        severity: mappedPriority,
        status: "pending",
        confirmedSeverity: null,
        confirmedCategory: null,
        targetOwnerId: targetOwnerId ? new mongoose.Types.ObjectId(String(targetOwnerId)) : null,
        priorityScore: mappedPriorityScore,
        aiReview: {
          score: Number(score || 0),
          labels: Array.isArray(labels) ? labels : [],
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

  try {
    await Notification.create({
      userId: null,
      actorId: null,
      type: "ADMIN_REPORT_PENDING",
      targetType: "report",
      targetId: report._id,
      message: `AI flagged ${targetType} (${severity})`,
      data: {
        reportId: String(report._id),
        source: "ai",
        targetType,
        targetId: String(targetId),
        suggestedSeverity: severity,
        category: category || null,
        score: Number(score || 0),
        labels: Array.isArray(labels) ? labels : [],
        reasonCode,
        reason: reason || "ai_flagged",
      },
      isPersistent: false,
      dedupeKey: `admin:report:${report._id}:pending`,
    });
  } catch (e) {
    if (e?.code !== 11000) {
      console.error("AI admin notification error:", e);
    }
  }

  return report;
}

// =========================
// POST MEDIA UPLOAD (LOCAL) - Phase 1
// =========================

// folder: /uploads/posts/{userId}/
const ALLOWED_IMAGE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_VIDEO = new Set(["video/mp4", "video/webm", "video/quicktime"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 6,
  },
  fileFilter: function (req, file, cb) {
    const mt = String(file.mimetype || "");
    if (ALLOWED_IMAGE.has(mt) || ALLOWED_VIDEO.has(mt)) return cb(null, true);
    return cb(new Error("UNSUPPORTED_MEDIA_TYPE"));
  },
});

// POST /posts/media/upload
// multipart/form-data: files[] (max 6)
// response: { status:"success", items:[{ type, url }] }
router.post("/media/upload", auth, upload.array("files", 6), async (req, res) => {
  try {
    const userId = String(req.user?._id || "");
    const files = Array.isArray(req.files) ? req.files : [];

    // ✅ enforce duration for uploaded videos (Base/VIP)
    const isVip = !!req.user?.isVip;
    const maxSeconds = isVip ? 180 : 60;

    try {
      for (const f of files) {
        const mt = String(f.mimetype || "").toLowerCase();
        const isVideo = mt.startsWith("video/");
        if (!isVideo) continue;

        const tmpPath = writeTempBufferToFile(f.buffer, f.originalname || "upload.bin");
        try {
          const duration = await ffprobeDurationSeconds(tmpPath);
          if (duration > maxSeconds) {
            const msgBase = "Video is too long. Max duration is 1 minute (VIP can upload up to 3 minutes).";
            const msgVip = "Video is too long. Max duration is 3 minutes.";

            return res.status(400).json({
              status: "error",
              message: isVip ? msgVip : msgBase,
            });
          }
        } finally {
          try { fs.unlinkSync(tmpPath); } catch (_) {}
        }
      }
    } catch (err) {
      return res.status(500).json({ status: "error", message: "Video duration check failed." });
    }

    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    if (!files.length) {
      return res.status(400).json({ status: "error", message: "No files uploaded" });
    }

    const items = [];
    for (const f of files) {
      const mt = String(f.mimetype || "").toLowerCase();
      const type = ALLOWED_VIDEO.has(mt) ? "video" : "image";

      const filename = makeScopedFilename("post", f.originalname, mt);
      const key = buildObjectKey({
        userId,
        scope: "post",
        filename,
        folder: "posts",
      });

      const uploaded = await uploadBufferToR2({
        key,
        body: f.buffer,
        contentType: mt || "application/octet-stream",
      });

      items.push({ type, url: uploaded.url });
    }

    return res.json({ status: "success", items });
  } catch (err) {
    console.error("POST_MEDIA_UPLOAD_FAILED:", err?.message || err);
    return res.status(500).json({ status: "error", message: "Upload failed" });
  }
});

// multer error mapper
router.use((err, req, res, next) => {
  if (!err) return next();
  if (String(err.message) === "UNSUPPORTED_MEDIA_TYPE") {
    return res.status(415).json({ status: "error", message: "Unsupported media type" });
  }
  if (String(err.code) === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ status: "error", message: "File too large" });
  }
  console.error("MULTER_ERR:", err);
  return res.status(400).json({ status: "error", message: "Upload error" });
});

/**
 * Utils comuni per paginazione
 */
function getPaginationParams(req) {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;
    return { page, limit, skip };
}

function isUserDeletedLike(user) {
  return user?.isDeleted === true || !!user?.deletedAt;
}

async function getNonPublicAuthorIds({ isAdminViewer = false } = {}) {
  if (isAdminViewer) return [];

  const docs = await User.find({
    $or: [
      { accountType: "admin" },
      { isBanned: true },
      { isDeleted: true },
      { deletedAt: { $ne: null } },
    ],
  })
    .select("_id")
    .lean();

  return docs.map((u) => u._id);
}

function pickEventStartEnd(ev) {
  const start =
    ev?.liveMeta?.startedAt ||
    ev?.startedAt ||
    ev?.startTime ||
    ev?.plannedStartTime ||
    null;

  const end =
    ev?.liveMeta?.endedAt ||
    ev?.endedAt ||
    null;

  return { start, end };
}

function isEventVisibleNow(ev, nowMs) {
  if (!ev || !ev.status) return false;
  if (ev.status === "finished" || ev.status === "cancelled") return false;

  const { start } = pickEventStartEnd(ev);
  const startMs = start ? new Date(start).getTime() : NaN;

  if (ev.status === "live") {
    if (!Number.isFinite(startMs)) return false;
    const maxLiveMs = 12 * 3600 * 1000;
    return nowMs - startMs <= maxLiveMs;
  }

  if (ev.status === "scheduled") {
    if (!Number.isFinite(startMs)) return false;
    const leadHours = Math.max(0, Math.min(Number(ev.profilePromoLeadHours ?? 2), 48));
    const leadMs = leadHours * 3600 * 1000;
    return nowMs >= (startMs - leadMs);
  }

  return false;
}

async function guardPostAccessForComments({ meId, post, viewerAccountType = "" }) {
  const meIdStr = String(meId);
  const authorIdStr = String(post.authorId);
  const isAdminViewer = String(viewerAccountType || "").toLowerCase() === "admin";

  const author = await User.findById(post.authorId)
    .select("accountType isPrivate isBanned isDeleted deletedAt")
    .lean();

  if (!author) {
    return { ok: false, status: 404, code: "POST_NOT_FOUND", message: "Post not found" };
  }

  // admin-authored content stays invisible in social/public flows
  if (author?.accountType === "admin") {
    return { ok: false, status: 404, code: "POST_NOT_FOUND", message: "Post not found" };
  }

  // banned/deleted invisible to normal users
  if (!isAdminViewer && (author?.isBanned === true || isUserDeletedLike(author))) {
    return { ok: false, status: 404, code: "POST_NOT_FOUND", message: "Post not found" };
  }

  // block either side
  const blocked = await Block.findOne({
    $or: [
      { blockerId: meId, blockedId: post.authorId },
      { blockerId: post.authorId, blockedId: meId },
    ],
  })
    .select("_id")
    .lean();

  if (blocked) {
    return { ok: false, status: 403, code: "CONTENT_NOT_AVAILABLE", message: "Content not available" };
  }

  const isOwner = meIdStr === authorIdStr;

  // admin moderation bypass
  if (isAdminViewer) {
    return { ok: true, isOwner };
  }

  // followers-only post
  if (post.visibility === "followers" && !isOwner) {
    const rel = await Follow.findOne({
      followerId: meId,
      followingId: post.authorId,
      status: "accepted",
    })
      .select("_id")
      .lean();

    if (!rel) {
      return { ok: false, status: 403, code: "POST_FOLLOWERS_ONLY", message: "This post is followers-only" };
    }
  }

  // private profile => contenuti solo se accepted (coerente con screen)
  if (author?.isPrivate === true && !isOwner) {
    const rel = await Follow.findOne({
      followerId: meId,
      followingId: post.authorId,
      status: "accepted",
    })
      .select("_id")
      .lean();

    if (!rel) {
      return { ok: false, status: 403, code: "PROFILE_PRIVATE", message: "This profile is private" };
    }
  }

  return { ok: true, isOwner };
}

/**
 * POST /posts
 * Creazione di un nuovo post
 */
router.post("/", auth, async (req, res) => {
  try {
    const {
      text,
      tags = [],
      visibility = "public",

      // nuovo
      media = [],
      poll = null,
      location = null,
      commentPolicy = "everyone",

      // legacy
      images = [],
      video = null,
    } = req.body;

    const trimmedText = (text || "").trim();

    const postRl = canCreatePost(req.user._id);
    if (!postRl.ok) {
      return res.status(429).json({
        status: "error",
        code: "POST_RATE_LIMIT",
        message: "You are posting too fast",
        retryAfterMs: postRl.retryAfterMs,
      });
    }

    const check = detectContentSafety(trimmedText, "public");
    if (check.blocked) {
      return res.status(400).json({
        status: "error",
        code: check.code,
        message: check.message,
      });
    }

    // --- visibility ---
    if (!["public", "followers"].includes(visibility)) {
      return res.status(400).json({ error: "Invalid visibility value." });
    }

    // --- commentPolicy ---
    if (!["everyone", "followers", "none"].includes(commentPolicy)) {
      return res.status(400).json({ error: "Valore di commentPolicy non valido." });
    }

    // --- normalizza media: usa media[] se presente, altrimenti converti legacy images/video ---
    let normalizedMedia = Array.isArray(media) ? media : [];

    const legacyImages = Array.isArray(images) ? images : [];
    if (legacyImages.length > 3) {
      return res.status(400).json({ error: "Un post può avere al massimo 3 immagini." });
    }

    // se il client vecchio manda images/video e media è vuoto, convertiamo
    if (normalizedMedia.length === 0) {
      if (legacyImages.length) {
        normalizedMedia = legacyImages.map((url) => ({ type: "image", url }));
      }
      if (video) {
        normalizedMedia.push({ type: "video", url: video });
      }
    }

    // valida media
    if (!Array.isArray(normalizedMedia)) normalizedMedia = [];
    if (normalizedMedia.length > 6) {
      return res.status(400).json({ error: "Un post può avere al massimo 6 media." });
    }

    for (const m of normalizedMedia) {
      if (!m || !["image", "video"].includes(m.type) || !m.url || typeof m.url !== "string") {
        return res.status(400).json({
          error: "Media non valido. Ogni item deve avere { type: 'image'|'video', url: string }.",
        });
      }
    }

    // ✅ anti-bypass: allow only locally hosted media for posts
    const meId = String(req.user?._id || "");

    function isAllowedPostMediaUrl(url) {
      const u = String(url || "").trim();
      const r2Base = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");

      if (!u) return false;

      if (r2Base && u.startsWith(`${r2Base}/users/${meId}/posts/`)) {
        return true;
      }

      return false;
    }

    for (const m of normalizedMedia) {
      if (!isAllowedPostMediaUrl(m.url)) {
        return res.status(400).json({
          error: "Invalid media url. Please upload media using the official uploader.",
        });
      }
    }

    // --- poll validate (opzionale) ---
    let normalizedPoll = null;

    if (poll && typeof poll === "object") {
      const q = (poll.question || "").trim();
      const opts = Array.isArray(poll.options) ? poll.options : [];

      if (!q) {
        return res.status(400).json({ error: "poll.question is required." });
      }

      const cleaned = opts
        .map((o) => {
          if (typeof o === "string") return { text: o.trim() };
          if (o && typeof o.text === "string") return { text: o.text.trim() };
          return null;
        })
        .filter((x) => x && x.text);

      if (cleaned.length < 2 || cleaned.length > 6) {
        return res.status(400).json({ error: "A poll must have 2 to 6 options." });
      }

      // Fase 1: durata SOLO 1..7 giorni (no endsAt libero dal client)
      const durationDays = Number(poll.durationDays);
      if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 7) {
        return res.status(400).json({ error: "poll.durationDays must be between 1 and 7." });
      }

      const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

      normalizedPoll = {
        question: q,
        options: cleaned.map((x) => ({ text: x.text, votesCount: 0 })),
        allowMultiple: false, // Fase 1: 1 voto per utente
        endsAt,
      };
    }

    // Fase 1: solo VIP possono creare poll
    if (normalizedPoll && !req.user?.isVip) {
      return res.status(403).json({ error: "Only VIP users can create polls." });
    }

    // --- location validate (opzionale) ---
    let normalizedLocation = null;
    if (location && typeof location === "object") {
      const name = location.name ? String(location.name).trim() : null;
      const lat = location.lat !== undefined && location.lat !== null ? Number(location.lat) : null;
      const lng = location.lng !== undefined && location.lng !== null ? Number(location.lng) : null;

      if (lat !== null && (Number.isNaN(lat) || lat < -90 || lat > 90)) {
        return res.status(400).json({ error: "location.lat non valido." });
      }
      if (lng !== null && (Number.isNaN(lng) || lng < -180 || lng > 180)) {
        return res.status(400).json({ error: "location.lng non valido." });
      }

      if (name || lat !== null || lng !== null) {
        normalizedLocation = { name: name || null, lat, lng };
      }
    }

    // --- contenuto minimo ---
    const hasText = !!trimmedText;
    const hasMedia = normalizedMedia.length > 0;
    const hasPoll = !!(normalizedPoll && normalizedPoll.question);

    // Fase 1: poll = solo testo (niente media)
    if (hasPoll && hasMedia) {
      return res.status(400).json({ error: "Poll posts cannot include media." });
    }

    if (!hasText && !hasMedia && !hasPoll) {
      return res.status(400).json({
        error: "The post must contain at least text, media, or a poll.",
      });
    }

    // ✅ prendo area/language dal profilo (source of truth)
    const me = await User.findById(req.user._id).select("area language").lean();

    const safeArea = (me?.area ? String(me.area) : "").trim().toLowerCase();
    const safeLang = (me?.language ? String(me.language) : "").trim().toLowerCase();

    let aiModeration = {
      flagged: false,
      score: 0,
      labels: [],
      reason: null,
      provider: "none",
      model: null,
    };

    if (trimmedText) {
      aiModeration = await analyzeTextModeration(trimmedText, {
        source: "post",
        visibility,
      });
    }

    const aiSuggestedSeverity = inferAISuggestedSeverity(aiModeration);
    const aiCategory = inferAICategory(aiModeration);
    const initialModerationStatus = aiModeration.flagged ? "under_review" : "visible";

    const post = new Post({
      authorId: req.user._id,
      text: trimmedText,
      tags,
      visibility,

      // meta nascosti per CERCA VIP
      area: safeArea,
      language: safeLang,

      commentPolicy,
      media: normalizedMedia,
      poll: normalizedPoll,
      location: normalizedLocation,

      // legacy
      images: legacyImages,
      video: video || null,

      moderation: {
        status: initialModerationStatus,
        hiddenBy: aiModeration.flagged ? "ai" : null,
        hiddenReason: aiModeration.flagged ? (aiModeration.reason || "ai_flagged") : null,
        hiddenSeverity: aiModeration.flagged ? aiSuggestedSeverity : null,
        hiddenCategory: aiModeration.flagged ? aiCategory : null,
        hiddenAt: aiModeration.flagged ? new Date() : null,
        hiddenByAdminId: null,
        ai: {
          flagged: aiModeration.flagged,
          score: aiModeration.score,
          labels: aiModeration.labels,
          reason: aiModeration.reason,
          provider: aiModeration.provider,
          model: aiModeration.model,
          reviewedAt: new Date(),
        },
      },
    });

    await post.save();

    if (aiModeration.flagged && aiSuggestedSeverity === "gravissimo") {
      await createOrUpdateAIReport({
        targetType: "post",
        targetId: post._id,
        targetOwnerId: req.user._id,
        reason: aiModeration.reason || "ai_flagged",
        severity: aiSuggestedSeverity,
        category: aiCategory,
        score: aiModeration.score,
        labels: aiModeration.labels,
      });

      try {
        await AdminAuditLog.create({
          adminId: null,
          actionType: "AI_HIDE_POST",
          targetType: "post",
          targetId: String(post._id),
          meta: {
            severity: aiSuggestedSeverity,
            category: aiCategory,
            reason: aiModeration.reason || "ai_flagged",
            score: aiModeration.score,
            labels: aiModeration.labels,
          },
        });
      } catch (e) {
        console.warn("AI_HIDE_POST audit skipped:", e?.message || e);
      }
    }

    // ✅ non leakare area/language
    const safePost = await Post.findById(post._id)
      .select("-area -language")
      .populate("authorId", "username displayName avatar accountType")
      .lean();

    return res.status(201).json(safePost);

  } catch (err) {
    console.error("Errore creazione post:", err);
    return res.status(500).json({ error: "Errore interno durante la creazione del post." });
  }
});

// POST /posts/:id/poll/vote
// Body: { optionIndex: number }
// Regole:
// - 1 voto per utente
// - VIP può cambiare voto
// - Base: non modificabile
// - voto anonimo (backend conosce userId ma non lo espone)
router.post("/:id/poll/vote", auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const meId = req.user._id;

    const optionIndex = Number(req.body?.optionIndex);
    if (!Number.isInteger(optionIndex)) {
      return res.status(400).json({ status: "error", message: "optionIndex must be an integer" });
    }

    const post = await Post.findOne({
      _id: postId,
      "moderation.isDeleted": { $ne: true },
      isHidden: { $ne: true },
      "moderation.status": { $nin: ["hidden", "under_review"] }
    });

    if (!post) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }

    if (!post.poll || !post.poll.question) {
      return res.status(400).json({ status: "error", message: "This post is not a poll" });
    }

    const endsAt = post.poll.endsAt ? new Date(post.poll.endsAt) : null;
    if (endsAt && !Number.isNaN(endsAt.getTime()) && Date.now() >= endsAt.getTime()) {
      return res.status(400).json({ status: "error", message: "Poll is closed" });
    }

    const options = Array.isArray(post.poll.options) ? post.poll.options : [];
    if (optionIndex < 0 || optionIndex >= options.length) {
      return res.status(400).json({ status: "error", message: "Invalid optionIndex" });
    }

    // trova voto esistente
    const existing = await PollVote.findOne({ postId, userId: meId }).lean();

    // se esiste e sta provando a cambiare
    if (existing && existing.optionIndex !== optionIndex) {
      const isVip = !!req.user?.isVip;
      if (!isVip) {
        return res.status(403).json({
          status: "error",
          message: "Only VIP users can change their vote",
        });
      }
    }

    // se esiste e sta votando uguale => idempotente
    if (existing && existing.optionIndex === optionIndex) {
      // ritorna poll aggiornato (già lo è)
      const poll = post.poll.toObject ? post.poll.toObject() : post.poll;
      return res.json({
        status: "success",
        poll,
        myVoteIndex: existing.optionIndex,
      });
    }

    // applica voto:
    // caso 1: primo voto -> incrementa
    // caso 2: cambio voto (VIP) -> decrementa old + incrementa new
    if (!existing) {
      // first vote
      post.poll.options[optionIndex].votesCount =
        Number(post.poll.options[optionIndex].votesCount || 0) + 1;

      await Promise.all([
        post.save(),
        PollVote.create({ postId, userId: meId, optionIndex }),
      ]);
    } else {
      // change vote (VIP)
      const oldIdx = Number(existing.optionIndex);

      if (oldIdx >= 0 && oldIdx < post.poll.options.length) {
        const oldCount = Number(post.poll.options[oldIdx].votesCount || 0);
        post.poll.options[oldIdx].votesCount = Math.max(0, oldCount - 1);
      }

      post.poll.options[optionIndex].votesCount =
        Number(post.poll.options[optionIndex].votesCount || 0) + 1;

      await Promise.all([
        post.save(),
        PollVote.updateOne(
          { postId, userId: meId },
          { $set: { optionIndex } }
        ),
      ]);
    }

    const poll = post.poll.toObject ? post.poll.toObject() : post.poll;

    return res.json({
      status: "success",
      poll,
      myVoteIndex: optionIndex,
    });
  } catch (err) {
    // dup key = già votato (race)
    if (String(err?.code) === "11000") {
      return res.status(409).json({ status: "error", message: "Already voted" });
    }
    console.error("POLL_VOTE_FAILED:", err?.message || err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * GET /api/posts/me
 * Post pubblicati dall'utente loggato
 */
router.get("/me", auth, async (req, res) => {
  try {
    const { limit, skip, page } = getPaginationParams(req);

    const baseQuery = { authorId: req.user._id, "moderation.isDeleted": { $ne: true } };

    // ✅ exclude hidden posts (Phase 1)
    baseQuery.isHidden = { $ne: true };
    baseQuery["moderation.status"] = { $ne: "hidden" };

    const [posts, total] = await Promise.all([
      Post.find(baseQuery)
        .select("-area -language")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("authorId", "displayName avatar accountType role"),
      Post.countDocuments(baseQuery),
    ]);

    return res.json({
      page,
      limit,
      total,
      items: posts,
    });
  } catch (err) {
    console.error("Errore /posts/me:", err);
    return res.status(500).json({ error: "Errore interno durante il recupero dei post." });
  }
});

/**
 * GET /posts/user/:userId
 * Post pubblicati da uno specifico utente (profilo pubblico)
 * Applica filtro MUTE: se l'utente è mutato, non ritorna nulla.
 */
router.get("/user/:userId", auth, async (req, res) => {
  try {
    const { limit, skip, page } = getPaginationParams(req);
    const { userId } = req.params;

    // 🔒 BLOCK GUARD
    const meId = req.user?._id?.toString();
    if (meId) {
      const blocked = await isUserBlockedEitherSide(meId, String(userId));
      if (blocked) {
        return res.status(403).json({
          status: "error",
          code: "PROFILE_BLOCKED",
          message: "Contenuto non disponibile",
        });
      }
    }

    // ✅ PRIVACY GUARD: se profilo privato, i post sono visibili solo a:
    // - owner
    // - follower accepted
    const targetUser = await User.findById(userId)
      .select("_id isPrivate accountType isBanned isDeleted deletedAt")
      .lean();
    if (!targetUser) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const isAdminViewer = String(req.user?.accountType || "").toLowerCase() === "admin";

    if (
      !isAdminViewer &&
      (
        targetUser?.accountType === "admin" ||
        targetUser?.isBanned === true ||
        isUserDeletedLike(targetUser)
      )
    ) {
      return res.status(404).json({
        status: "error",
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    const isOwner = meId && meId === String(targetUser._id);

    if (!isAdminViewer && targetUser.isPrivate === true && !isOwner) {
      const canSee = await Follow.findOne({
        followerId: req.user._id,
        followingId: targetUser._id,
        status: "accepted",
      })
        .select("_id")
        .lean();

      if (!canSee) {
        return res.status(403).json({
          status: "error",
          code: "PROFILE_PRIVATE",
          message: "Private profile",
        });
      }
    }

    let visibilityList = ["public"];
    if (isOwner) visibilityList = ["public", "followers"];
    else {
      const rel = await Follow.findOne({
        followerId: req.user._id,
        followingId: targetUser._id,
        status: "accepted",
      }).select("_id").lean();

      if (rel) visibilityList = ["public", "followers"];
    }

    const authorObjectId = new mongoose.Types.ObjectId(String(userId));

    const baseQuery = {
      $or: [{ authorId: authorObjectId }, { authorId: String(userId) }],
      visibility: { $in: visibilityList },
      "moderation.isDeleted": { $ne: true },
      isHidden: { $ne: true },
    };

    if (isOwner) {
      baseQuery["moderation.status"] = { $ne: "hidden" };
    } else {
      baseQuery["moderation.status"] = "visible";
    }

    const [posts, total] = await Promise.all([
      Post.find(baseQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("authorId", "username displayName avatar accountType"),
      Post.countDocuments(baseQuery),
    ]);

    return res.json({
      page,
      limit,
      total,
      items: posts,
    });
  } catch (err) {
    console.error("Errore /posts/user/:userId:", err);
    return res.status(500).json({ error: "Errore interno durante il recupero dei post utente." });
  }
});

/**
 * GET /posts/feed/fedbase
 * FEDBASE: feed di interessi base, per tutti gli utenti loggati
 */
router.get("/feed/fedbase", auth, async (req, res) => {
  try {
    const { limit, skip, page } = getPaginationParams(req);

    // 1) prendo gli utenti mutati
    const mutedUserIds = await getMutedUserIds(req.user._id);

    // 1b) prendo gli utenti bloccati (both sides) — rete di sicurezza globale feed
    const meId = req.user._id;
    const blocks = await Block.find({
      $or: [{ blockerId: meId }, { blockedId: meId }],
    })
      .select("blockerId blockedId")
      .lean();

    const blockedSet = new Set();
    for (const b of blocks) {
      if (String(b.blockerId) === String(meId)) blockedSet.add(String(b.blockedId));
      if (String(b.blockedId) === String(meId)) blockedSet.add(String(b.blockerId));
    }
    const blockedUserIds = Array.from(blockedSet);
    const isAdminViewer = String(req.user?.accountType || "").toLowerCase() === "admin";
    const hiddenAuthorIds = await getNonPublicAuthorIds({ isAdminViewer });

    // 2) query base + filtro mute + filtro block
    const baseQuery = {
      visibility: "public",
      "moderation.isDeleted": { $ne: true },
      authorId: { $nin: [...mutedUserIds, ...blockedUserIds, ...hiddenAuthorIds] },
    };

    // ✅ exclude hidden posts (Phase 1)
    baseQuery.isHidden = { $ne: true };
    baseQuery["moderation.status"] = "visible";

    const [posts, total] = await Promise.all([
      Post.find(baseQuery)
        .select("-area -language")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("authorId", "username avatar accountType"),
      Post.countDocuments(baseQuery),
    ]);

    return res.json({
      page,
      limit,
      total,
      items: posts,
    });
  } catch (err) {
    console.error("Errore FEDBASE:", err);
    return res
      .status(500)
      .json({ error: "Errore interno durante il recupero del FEDBASE." });
  }
});

/**
 * GET /posts/feed/fedvip
 * FEDVIP: feed basato su interestsVip (solo per utenti con isVip === true)
 */
router.get('/feed/fedvip', auth, async (req, res) => {
  try {
    // ✅ VIP = status boolean
    if (req.user?.isVip !== true) {
      return res.status(403).json({ error: 'Accesso riservato agli utenti VIP.' });
    }

    const { limit, skip, page } = getPaginationParams(req);

    const interestsVip = Array.isArray(req.user.interestsVip) ? req.user.interestsVip : [];

    // MUTE
    const mutedUserIds = await getMutedUserIds(req.user._id);

    // BLOCK (both sides)
    const meId = req.user._id;
    const blocks = await Block.find({
      $or: [{ blockerId: meId }, { blockedId: meId }],
    })
      .select("blockerId blockedId")
      .lean();

    const blockedSet = new Set();
    for (const b of blocks) {
      if (String(b.blockerId) === String(meId)) blockedSet.add(String(b.blockedId));
      if (String(b.blockedId) === String(meId)) blockedSet.add(String(b.blockerId));
    }
    const blockedUserIds = Array.from(blockedSet);
    const isAdminViewer = String(req.user?.accountType || "").toLowerCase() === "admin";
    const hiddenAuthorIds = await getNonPublicAuthorIds({ isAdminViewer });

    const query = {
      visibility: "public",
      "moderation.isDeleted": { $ne: true },
      isHidden: { $ne: true },
      "moderation.status": "visible",
      authorId: { $nin: [...mutedUserIds, ...blockedUserIds, ...hiddenAuthorIds] },
    };

    if (interestsVip.length > 0) {
      query.tags = { $in: interestsVip };
    }

    const [posts, total] = await Promise.all([
      Post.find(query)
        .select('-area -language')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('authorId', 'username avatar accountType'),
      Post.countDocuments(query),
    ]);

    return res.json({
      page,
      limit,
      total,
      items: posts,
    });
  } catch (err) {
    console.error('Errore FEDVIP:', err);
    return res.status(500).json({ error: 'Errore interno durante il recupero del FEDVIP.' });
  }
});

router.get("/feed/fed", auth, async (req, res) => {
  try {
    const { limit, skip, page } = getPaginationParams(req);
    const meObjectId = req.user._id;          // ObjectId vero (per query)
    const meId = String(req.user._id);        // stringa (per confronti / $nin)

    const contentContext = req.user?.appSettings?.contentContext || "standard";
    const isVip = req.user?.isVip === true;
    const isAdminViewer = String(req.user?.accountType || "").toLowerCase() === "admin";

    const interestsVip = Array.isArray(req.user?.interestsVip) ? req.user.interestsVip : [];
    const interestsBase = Array.isArray(req.user?.interestsBase) ? req.user.interestsBase : [];
    const interestsProfile = Array.isArray(req.user?.interests) ? req.user.interests : [];

    let mode = "fallback_trending";
    let driver = [];
    let support = interestsProfile;

    if (isVip && interestsVip.length > 0) {
      mode = "vip_manual";
      driver = interestsVip;
    } else if (interestsBase.length > 0) {
      mode = "base_interests";
      driver = interestsBase;
    } else if (interestsProfile.length > 0) {
      mode = "base_interests";
      driver = interestsProfile;
      support = [];
    }

    const usedInterests = Array.from(new Set([...(driver || []), ...(support || [])]))
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    // MUTE
    const mutedDocs = await MutedUser.find({ userId: meObjectId })
      .select("mutedUserId")
      .lean();
    const mutedIds = mutedDocs.map((m) => m.mutedUserId.toString());

    // BLOCK (both sides)
    const blocks = await Block.find({
      $or: [{ blockerId: meObjectId }, { blockedId: meObjectId }],
    })
      .select("blockerId blockedId")
      .lean();

    const blockedSet = new Set();
    for (const b of blocks) {
      if (String(b.blockerId) === String(meId)) blockedSet.add(String(b.blockedId));
      if (String(b.blockedId) === String(meId)) blockedSet.add(String(b.blockerId));
    }
    const blockedIds = Array.from(blockedSet);

    // FOLLOW accepted (per visibility=followers)
    const follows = await Follow.find({ followerId: meObjectId })
      .select("followingId status")
      .lean();

    const followingAcceptedIds = follows
      .filter((f) => !f.status || f.status === "accepted")
      .map((f) => f.followingId);

    const hiddenAuthorIds = await getNonPublicAuthorIds({ isAdminViewer });

    // autori privati che NON seguo
    let privateExcludedIds = [];

    if (!isAdminViewer) {
      const privateUsers = await User.find(
        {
          isPrivate: true,
          _id: { $nin: [meObjectId, ...followingAcceptedIds] },
        },
        { _id: 1 }
      ).lean();

      privateExcludedIds = privateUsers.map((u) => u._id);
    }

    // privacy
    const visibilityQuery = {
      "moderation.isDeleted": { $ne: true },
      isHidden: { $ne: true },
      "moderation.status": "visible",
      $or: [
        { visibility: "public" },
        { visibility: "followers", authorId: { $in: followingAcceptedIds } },
      ],
    };

    // hard exclude
    const excludedAuthorIds = [
      ...mutedDocs.map((m) => m.mutedUserId),
      ...blocks.flatMap((b) => {
        const out = [];
        if (String(b.blockerId) === meId) out.push(b.blockedId);
        if (String(b.blockedId) === meId) out.push(b.blockerId);
        return out;
      }),
      ...privateExcludedIds,
      ...hiddenAuthorIds,
      meObjectId,
    ];

    const excludeAuthors = {
      authorId: { $nin: excludedAuthorIds },
    };

    // retrieval
    const pool = Math.max(limit * 4, 40);
    let primary = [];
    let filler = [];

    if (usedInterests.length > 0) {
      primary = await Post.find({
        ...visibilityQuery,
        ...excludeAuthors,
        tags: { $in: usedInterests },
      })
        .populate({ path: "authorId", select: "displayName avatar accountType role" })
        .select("-area -language")
        .sort({ createdAt: -1 })
        .limit(pool)
        .lean();
    }

    const need = pool - primary.length;
    if (need > 0 && usedInterests.length > 0) {
      const kws = usedInterests
        .slice(0, 6)
        .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const rx = new RegExp(kws.join("|"), "i");

      filler = await Post.find({
        ...visibilityQuery,
        ...excludeAuthors,
        text: { $regex: rx },
        _id: { $nin: primary.map((p) => p._id) },
      })
        .populate({ path: "authorId", select: "displayName avatar accountType role" })
        .select("-area -language")
        .sort({ createdAt: -1 })
        .limit(need)
        .lean();
    }

    // trending fallback
    if (usedInterests.length === 0) {
      primary = await Post.find({
        ...visibilityQuery,
        ...excludeAuthors,
      })
        .populate({ path: "authorId", select: "displayName avatar accountType role" })
        .select("-area -language")
        .sort({ createdAt: -1 })
        .limit(pool)
        .lean();
    }

    // context boost v1
    function contextBoost(post) {
      const blob = `${(post.tags || []).join(" ")} ${post.text || ""}`.toLowerCase();
      const hasLive = /\blive\b|\bevent\b|\broom\b|\bcam\b/.test(blob);

      if (contentContext === "neutral") return hasLive ? 0.7 : 1;
      if (contentContext === "live_events") return hasLive ? 1.25 : 1;
      return 1;
    }

    const merged = [...primary, ...filler]
      .map((p, i) => ({ p, score: (1000 - i) * contextBoost(p) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);

    const items = merged.slice(skip, skip + limit);

    return res.json({
      page,
      limit,
      total: merged.length,
      items,
      meta: { mode, usedInterests, contentContext },
    });
  } catch (err) {
    console.error("FED error:", err);
    return res.status(500).json({ error: "FED internal error" });
  }
});

/**
 * GET /posts/feed/following
 * Feed "Seguiti": post degli utenti che seguo
 */
router.get('/feed/following', auth, async (req, res) => {
    try {
        const { limit, skip, page } = getPaginationParams(req);

        const userId = req.user._id;

        const follows = await Follow.find({ followerId: userId })
          .select("followingId")
          .lean();

        const rawFollowingIds = follows.map(f => new mongoose.Types.ObjectId(f.followingId));
        const isAdminViewer = String(req.user?.accountType || "").toLowerCase() === "admin";

        let followingIds = rawFollowingIds;

        if (!isAdminViewer) {
          const visibleUsers = await User.find({
            _id: { $in: rawFollowingIds },
            accountType: { $ne: "admin" },
            isBanned: { $ne: true },
            isDeleted: { $ne: true },
            deletedAt: null,
          })
            .select("_id")
            .lean();

          const visibleSet = new Set(visibleUsers.map((u) => String(u._id)));
          followingIds = rawFollowingIds.filter((id) => visibleSet.has(String(id)));
        }

        if (followingIds.length === 0) {
            return res.json({
                page,
                limit,
                total: 0,
                items: [],
            });
        }

        const baseQuery = {
          authorId: { $in: followingIds },
          "moderation.isDeleted": { $ne: true },
        };

        // ✅ exclude hidden posts (Phase 1)
        baseQuery.isHidden = { $ne: true };
        baseQuery["moderation.status"] = "visible";

        const [posts, total] = await Promise.all([
          Post.find(baseQuery)
            .select("-area -language")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("authorId", "username avatar accountType"),
          Post.countDocuments(baseQuery),
        ]);

        return res.json({
            page,
            limit,
            total,
            items: posts,
        });
    } catch (err) {
        console.error('Errore feed following:', err);
        return res.status(500).json({ error: 'Errore interno durante il recupero del feed Seguiti.' });
    }
});

/**
 * GET /feed/following-mixed
 * Feed "Seguiti": Aggiungi eventi scheduled e live
 */
router.get("/feed/following-mixed", auth, async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationParams(req);
    const nowMs = Date.now();
    const mutedUserIds = await getMutedUserIds(req.user._id);
    const mutedSet = new Set(mutedUserIds.map((id) => String(id)));

    // 1) followingIds (fonte unica: collection Follow)
    const followerId = req.user._id;

    // ✅ SOLO FOLLOW ACCEPTED (evita leak profili privati / pending)
    const follows = await Follow.find({ followerId, status: "accepted" })
      .select("followingId")
      .lean();

    const rawFollowingIds = follows.map((f) => f.followingId);

    const weird = rawFollowingIds.filter((v) => v && typeof v === "object" && !v._bsontype && !v._id);
    if (weird.length) console.warn("following-mixed: weird followingId objects:", weird);

    const normalizedFollowingIds = rawFollowingIds
      .map((v) => {
        // v può essere ObjectId, stringa, oppure oggetto (popolato male o salvato male)
        if (!v) return null;

        // se è oggetto con _id
        if (typeof v === "object" && v._id) return String(v._id);

        // se è già ObjectId o stringa
        return String(v);
      })
      .filter(Boolean);

    const followingIds = normalizedFollowingIds;

    if (!followingIds || followingIds.length === 0) {
      return res.json({ page, limit, total: 0, items: [] });
    }

    // ✅ FIX #2: rete di sicurezza — escludi utenti bloccati (both sides)
    const blocks = await Block.find({
      $or: [
        { blockerId: followerId }, // io ho bloccato altri
        { blockedId: followerId }, // altri hanno bloccato me
      ],
    })
      .select("blockerId blockedId")
      .lean();

    const blockedSet = new Set();
    for (const b of blocks) {
      // se io sono il blocker, l'altro è blockedId
      if (String(b.blockerId) === String(followerId)) blockedSet.add(String(b.blockedId));
      // se io sono il blocked, l'altro è blockerId
      if (String(b.blockedId) === String(followerId)) blockedSet.add(String(b.blockerId));
    }

    const safeFollowingIds = followingIds.filter((id) => !blockedSet.has(String(id)));

    const badIds = safeFollowingIds
      .map((id) => String(id))
      .filter((id) => !mongoose.Types.ObjectId.isValid(id));

    if (badIds.length) {
      console.warn("following-mixed: invalid followingIds:", badIds);
    }

    const isAdminViewer = String(req.user?.accountType || "").toLowerCase() === "admin";

    let safeFollowingIdsNoAdmin = safeFollowingIds;

    if (!isAdminViewer) {
      const visibleUsers = await User.find({
        _id: { $in: safeFollowingIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
        accountType: { $ne: "admin" },
        isBanned: { $ne: true },
        isDeleted: { $ne: true },
        deletedAt: null,
      })
        .select("_id")
        .lean();

      const visibleSet = new Set(visibleUsers.map((u) => String(u._id)));
      safeFollowingIdsNoAdmin = safeFollowingIds.filter((id) => visibleSet.has(String(id)));
    }

    const safeFollowingObjIds = safeFollowingIdsNoAdmin
      .map((id) => String(id))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (safeFollowingObjIds.length === 0) {
      return res.json({ page, limit, total: 0, items: [] });
    }

    const pool = Math.max(limit * 3, 30);

    // 2) post dei seguiti
    const postQuery = {
      authorId: { $in: safeFollowingObjIds },
      visibility: { $in: ["public", "followers"] },
      "moderation.isDeleted": { $ne: true },
    };

    // ✅ exclude hidden posts (Phase 1)
    const finalPostQuery = {
      ...(postQuery || {}),
      isHidden: { $ne: true },
      "moderation.status": "visible",
    };

    const posts = await Post.find(finalPostQuery)
      .select("-area -language")
      .sort({ createdAt: -1 })
      .limit(pool)
      .populate("authorId", "username displayName avatar accountType")
      .lean();
      
    // 3) eventi candidati seguiti (promo + live)
    const events = await Event.find({
      creatorId: { $in: safeFollowingObjIds },
      status: { $in: ["scheduled", "live"] },
    })
      .sort({ updatedAt: -1 })
      .limit(pool)
      .populate("creatorId", "username displayName avatar accountType");

    const eventItems = [];
    for (const ev of events) {
      let publishedAt = null;

      if (ev.status === "scheduled") {
        publishedAt = ev.createdAt
          ? new Date(ev.createdAt)
          : ev.startTime
          ? new Date(ev.startTime)
          : null;
      } else if (ev.status === "live") {
        const { start } = pickEventStartEnd(ev);
        publishedAt = start
          ? new Date(start)
          : ev.updatedAt
          ? new Date(ev.updatedAt)
          : null;
      }

      if (!publishedAt || Number.isNaN(publishedAt.getTime())) continue;

      eventItems.push({
        type: ev.status === "scheduled" ? "event_scheduled" : "event",
        publishedAt: publishedAt.toISOString(),
        data: {
          _id: ev._id,
          eventId: ev._id,
          creatorId: ev.creatorId,
          creatorDisplayName: ev?.creatorId?.displayName || null,
          creatorAvatarUrl: ev?.creatorId?.avatar || null,
          status: ev.status,
          title: ev.title || null,
          description: ev.description || null,
          coverImage: ev.coverImage || ev.coverUrl || null,
          coverUrl: ev.coverUrl || ev.coverImage || null,
          startTime: ev.startTime || null,
          createdAt: ev.createdAt || null,
          updatedAt: ev.updatedAt || null,
          targetUrl: `/app/live/${ev._id}`,
          isPromoted: Boolean(ev.profilePromoEnabled && ev.profilePromoPublishedAt),
        },
      });
    }

    const postItems = posts.map((p) => {
      const authorObj = p?.authorId && typeof p.authorId === "object" ? p.authorId : null;
      const authorId = authorObj?._id ? String(authorObj._id) : String(p.authorId || "");

      return {
        type: "post",
        publishedAt: (p.createdAt ? new Date(p.createdAt) : new Date()).toISOString(),
        data: {
          _id: p._id,
          text: p.text ?? null,
          createdAt: p.createdAt ?? null,
          updatedAt: p.updatedAt ?? null,
          visibility: p.visibility ?? "public",
          likeCount: p.likeCount ?? 0,
          commentCount: p.commentCount ?? 0,

          // ✅ include media + poll for PostCard (fix: following feed only text)
          media: Array.isArray(p.media) ? p.media : [],
          images: Array.isArray(p.images) ? p.images : [],
          videos: Array.isArray(p.videos) ? p.videos : [],
          image: p.image ?? p.imageUrl ?? null,
          video: p.video ?? p.videoUrl ?? null,
          poll: p.poll ?? null,

          // ✅ QUESTO è quello che mancava al frontend
          authorId, // stringa SEMPRE

          // comodo per UI (già lo usi)
          authorDisplayName: authorObj?.displayName || null,
          authorAvatarUrl: authorObj?.avatar || null,
        },
      };
    });

    const merged = [...postItems, ...eventItems].sort((a, b) => {
      const at = new Date(a.publishedAt).getTime();
      const bt = new Date(b.publishedAt).getTime();
      return bt - at;
    });

    // ✅ MUTE FILTER (qui, subito dopo merged)
    const mergedFiltered = merged.filter((it) => {
      if (it?.type === "post") {
        const authorId = it?.data?.authorId?._id || it?.data?.authorId;
        return !mutedSet.has(String(authorId));
      }
      if (it?.type === "event") {
        const creatorId = it?.data?.creatorId?._id || it?.data?.creatorId;
        return !mutedSet.has(String(creatorId));
      }
      return true;
    });

    const items = mergedFiltered.slice(skip, skip + limit);
    const total = mergedFiltered.length;

    return res.json({ page, limit, total, items });
  } catch (err) {
    console.error("following-mixed error:", err);
    return res.status(500).json({ error: "Internal error following-mixed feed." });
  }
});

// POST /posts/:id/likes
// Toggle like/unlike
// ✅ Response stabile: { status:"success", liked:boolean, likeCount:number }
router.post("/:id/likes", auth, async (req, res) => {
  try {
    const postIdStr = String(req.params.id || "");
    const userIdStr = String(req.user?._id || "");

    if (!mongoose.Types.ObjectId.isValid(postIdStr)) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_POST_ID",
        message: "Invalid post id",
      });
    }
    if (!mongoose.Types.ObjectId.isValid(userIdStr)) {
      return res.status(401).json({
        status: "error",
        code: "INVALID_USER_ID",
        message: "Invalid user",
      });
    }

    const postObjId = new mongoose.Types.ObjectId(postIdStr);
    const userObjId = new mongoose.Types.ObjectId(userIdStr);
    const post = await Post.findById(postObjId).select("authorId").lean();
    if (!post) {
      return res.status(404).json({ status: "error", message: "Post not found" });
    }
    if (String(post.authorId) === String(userObjId)) {
      return res.status(400).json({ status: "error", message: "You can’t like your own post" });
    }

    // 1) Provo UNLIKE (delete). Se c'era, ho tolto il like.
    const removed = await PostLike.findOneAndDelete({
      postId: postObjId,
      userId: userObjId,
    }).lean();

    if (removed) {
      // decremento classico (compatibile con tutte le versioni mongoose)
      await Post.updateOne({ _id: postObjId }, { $inc: { likeCount: -1 } });

      // clamp a 0 (nel dubbio, evita valori negativi)
      await Post.updateOne({ _id: postObjId, likeCount: { $lt: 0 } }, { $set: { likeCount: 0 } });

      const p = await Post.findById(postObjId).select("likeCount").lean();
      return res.json({
        status: "success",
        liked: false,
        likeCount: p?.likeCount ?? 0,
      });
    }

    // 2) LIKE: creo (con unique index). Se duplicate -> era già liked.
    let created = false;
    try {
      await PostLike.create({ postId: postObjId, userId: userObjId });
      created = true;
    } catch (e) {
      if (e?.code === 11000) {
        created = false; // già liked (race/doppio click)
      } else {
        throw e;
      }
    }

    if (created) {
      await Post.findByIdAndUpdate(postObjId, { $inc: { likeCount: 1 } });

      // NOTIFICA (best effort)
      try {
        const post = await Post.findById(postObjId).select("authorId").lean();
        const ownerId = post?.authorId?.toString();

        if (ownerId && ownerId !== userIdStr) {
          await Notification.findOneAndUpdate(
            {
              userId: ownerId,
              type: "post_like",
              actorId: userObjId,
              targetType: "post",
              targetId: postObjId,
            },
            {
              $setOnInsert: {
                userId: ownerId,
                type: "post_like",
                actorId: userObjId,
                targetType: "post",
                targetId: postObjId,
                isRead: false,
                createdAt: new Date(),
              },
            },
            { upsert: true, new: false }
          );
        }
      } catch (e) {
        console.error("NOTIF_POST_LIKE_FAILED:", e?.message || e);
      }
    }

    const p = await Post.findById(postObjId).select("likeCount").lean();
    return res.json({
      status: "success",
      liked: true,
      likeCount: p?.likeCount ?? 0,
    });
  } catch (err) {
    console.error("Errore toggle like:", err);
    return res.status(500).json({
      status: "error",
      message: "Error while toggling like",
    });
  }
});

/**
 * POST /posts/:id/comment
 * Aggiunta di un commento ad un post + reply (parentCommentId)
 *
 * Body:
 *  - text: string (required)
 *  - parentCommentId: string (optional)  -> se presente, è una reply
 */
router.post("/:id/comment", auth, async (req, res) => {
  try {
    const postId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ status: "error", code: "INVALID_POST_ID", message: "Invalid post id" });
    }

    const { text, parentCommentId } = req.body || {};
    const trimmedText = String(text || "").trim();

    const commentRl = canCreateComment(req.user._id);
    if (!commentRl.ok) {
      return res.status(429).json({
        status: "error",
        code: "COMMENT_RATE_LIMIT",
        message: "You are commenting too fast",
        retryAfterMs: commentRl.retryAfterMs,
      });
    }

    const check = detectContentSafety(trimmedText, "public");
    if (check.blocked) {
      return res.status(400).json({
        status: "error",
        code: check.code,
        message: check.message,
      });
    }

    if (!trimmedText) {
      return res.status(400).json({ status: "error", code: "EMPTY_COMMENT", message: "Comment cannot be empty" });
    }

    // 1) Post
    const post = await Post.findById(postId)
      .select("authorId visibility commentPolicy isHidden moderation")
      .lean();

    if (
      !post ||
      post?.moderation?.isDeleted ||
      post?.isHidden === true ||
      post?.moderation?.status === "hidden" ||
      post?.moderation?.status === "under_review"
    ) {
      return res.status(404).json({
        status: "error",
        code: "POST_NOT_FOUND",
        message: "Post not found",
      });
    }

    // ✅ Guard access (block / followers-only / private / admin invisible)
    const g = await guardPostAccessForComments({
      meId: req.user._id,
      post,
      viewerAccountType: req.user?.accountType,
    });
    if (!g.ok) {
      return res.status(g.status).json({ status: "error", code: g.code, message: g.message });
    }

    // 🔐 commentPolicy enforcement
    const isOwner = !!g.isOwner;

    if (post.commentPolicy === "none" && !isOwner) {
      return res.status(403).json({ status: "error", code: "COMMENTS_DISABLED", message: "Comments are disabled" });
    }

    if (post.commentPolicy === "followers" && !isOwner) {
      const rel = await Follow.findOne({
        followerId: req.user._id,
        followingId: post.authorId,
        status: "accepted",
      }).select("_id").lean();

      if (!rel) {
        return res.status(403).json({ status: "error", code: "COMMENTS_FOLLOWERS_ONLY", message: "Only followers can comment" });
      }
    }

    // 🔐 visibility followers enforcement (se serve anche qui)
    if (post.visibility === "followers" && !isOwner) {
      const rel = await Follow.findOne({
        followerId: req.user._id,
        followingId: post.authorId,
        status: "accepted",
      }).select("_id").lean();

      if (!rel) {
        return res.status(403).json({ status: "error", code: "POST_FOLLOWERS_ONLY", message: "This post is followers-only" });
      }
    }

    // 2) Se è reply, valida e carica commento padre
    const isReply = !!parentCommentId;
    let parentComment = null;

    if (isReply) {
      if (!mongoose.Types.ObjectId.isValid(parentCommentId)) {
        return res.status(400).json({ error: "Invalid parentCommentId." });
      }

      parentComment = await Comment.findById(parentCommentId).lean();
      if (!parentComment) {
        return res.status(404).json({ error: "Father's comment not found." });
      }

      // safety: il parent deve appartenere a questo post
      if (parentComment.postId.toString() !== post._id.toString()) {
        return res.status(400).json({ error: "The parent comment does not belong to this post." });
      }
    }

    const aiModeration = await analyzeTextModeration(trimmedText, {
      source: "comment",
      visibility: "public",
    });

    const aiSuggestedSeverity = inferAISuggestedSeverity(aiModeration);
    const aiCategory = inferAICategory(aiModeration);

    // 3) Crea commento
    const comment = await Comment.create({
      postId: post._id,
      authorId: req.user._id,
      text: trimmedText,
      parentCommentId: isReply ? parentComment._id : null,
      moderation: {
        status: aiModeration.flagged ? "under_review" : "visible",
        hiddenBy: aiModeration.flagged ? "ai" : null,
        hiddenReason: aiModeration.flagged ? (aiModeration.reason || "ai_flagged") : null,
        hiddenSeverity: aiModeration.flagged ? aiSuggestedSeverity : null,
        hiddenCategory: aiModeration.flagged ? aiCategory : null,
        hiddenAt: aiModeration.flagged ? new Date() : null,
        hiddenByAdminId: null,
        ai: {
          flagged: aiModeration.flagged,
          score: aiModeration.score,
          labels: aiModeration.labels,
          reason: aiModeration.reason,
          provider: aiModeration.provider,
          model: aiModeration.model,
          reviewedAt: new Date(),
        },
      },
    });

    if (aiModeration.flagged && aiSuggestedSeverity === "gravissimo") {
      await createOrUpdateAIReport({
        targetType: "comment",
        targetId: comment._id,
        targetOwnerId: req.user._id,
        reason: aiModeration.reason || "ai_flagged",
        severity: aiSuggestedSeverity,
        category: aiCategory,
        score: aiModeration.score,
        labels: aiModeration.labels,
      });

      try {
        await AdminAuditLog.create({
          adminId: null,
          actionType: "AI_HIDE_COMMENT",
          targetType: "comment",
          targetId: String(comment._id),
          meta: {
            severity: aiSuggestedSeverity,
            category: aiCategory,
            reason: aiModeration.reason || "ai_flagged",
            score: aiModeration.score,
            labels: aiModeration.labels,
          },
        });
      } catch (e) {
        console.warn("AI_HIDE_COMMENT audit skipped:", e?.message || e);
      }
    }

    // 4) Aggiorna contatore commenti sul post
    const newCount = await Comment.countDocuments({
      postId: post._id,
      isDeleted: { $ne: true },
      "moderation.status": "visible",
    });
    await Post.findByIdAndUpdate(post._id, { $set: { commentCount: newCount } }).lean();

    // ==============================
    // NOTIFICHE: commento / reply
    // ==============================
    try {
      const ownerId = post.authorId?.toString();      // autore del post
      const actorId = req.user._id?.toString();       // chi commenta

      // 1) notifica al proprietario del post (se non è lo stesso utente)
      if (ownerId && actorId && ownerId !== actorId) {
        await Notification.create({
          userId: post.authorId,
          actorId: req.user._id,
          type: "SOCIAL_POST_COMMENTED",
          targetType: "post",
          targetId: post._id,
          message: "You received a comment on your post",
          data: {
            commentId: comment._id.toString(),
            parentCommentId: isReply ? parentComment._id.toString() : null,
            preview: trimmedText.slice(0, 120),
            isReply,
          },
          isPersistent: false,
          // dedupeKey deve essere UNIQUE per commento: così non collide mai
          dedupeKey: `post_comment:${comment._id.toString()}`,
        });
      }

      // 2) se è reply: notifica all’autore del commento padre
      if (isReply && parentComment?.authorId) {
        const parentAuthorId = parentComment.authorId.toString();

        // niente notifica se mi rispondo da solo
        // e niente doppione se parentAuthorId coincide col post owner (già notificato sopra)
        if (parentAuthorId !== actorId && parentAuthorId !== ownerId) {
          await Notification.create({
            userId: parentComment.authorId,
            actorId: req.user._id,
            type: "SOCIAL_POST_COMMENTED",
            targetType: "post",
            targetId: post._id,
            message: "You have received a reply to your comment",
            data: {
              commentId: comment._id.toString(),
              parentCommentId: parentComment._id.toString(),
              preview: trimmedText.slice(0, 120),
              isReply: true,
            },
            isPersistent: false,
            dedupeKey: `comment_reply:${comment._id.toString()}`,
          });
        }
      }
    } catch (e) {
      console.error("NOTIF_COMMENT_FAILED:", e?.message || e);
    }

    return res.status(201).json({
      comment,
      commentCount: newCount,
    });
  } catch (err) {
    console.error("Errore creazione commento:", err);
    return res.status(500).json({
      error: "Internal error while creating comment.",
    });
  }
});

// GET /posts/:id (single post)
// Used by PostDetailPage (notifications deep-link)
router.get("/:id", auth, async (req, res) => {
  try {
    const postIdStr = String(req.params.id || "");
    if (!mongoose.Types.ObjectId.isValid(postIdStr)) {
      return res.status(400).json({ status: "error", code: "INVALID_POST_ID", message: "Invalid post id" });
    }

    const post = await Post.findById(postIdStr)
      .populate("authorId", "username displayName avatar accountType isPrivate")
      .lean();

    if (!post || post?.moderation?.isDeleted || post?.isHidden === true) {
      return res.status(404).json({ status: "error", code: "POST_NOT_FOUND", message: "Post not found" });
    }

    const meId = String(req.user?._id || "");
    const ownerId = post?.authorId?._id ? String(post.authorId._id) : String(post.authorId || "");
    const isOwner = ownerId === meId;

    if (post?.moderation?.status === "hidden") {
      return res.status(404).json({ status: "error", code: "POST_NOT_FOUND", message: "Post not found" });
    }

    if (post?.moderation?.status !== "visible" && !isOwner) {
      return res.status(404).json({ status: "error", code: "POST_NOT_FOUND", message: "Post not found" });
    }

    // access guard (reuse the same rules used for comments)
    const g = await guardPostAccessForComments({
      meId: req.user._id,
      post,
      viewerAccountType: req.user?.accountType,
    });
    if (!g.ok) {
      return res.status(g.status).json({ status: "error", code: g.code, message: g.message });
    }

    const liked = await PostLike.findOne({ postId: post._id, userId: req.user._id }).select("_id").lean();
    post.likedByMe = !!liked;

    return res.json({ status: "success", item: post });
  } catch (err) {
    console.error("GET /posts/:id error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// GET /posts/:id/comments
// Ritorna la lista dei commenti di un post (con paginazione semplice)
router.get("/:id/comments", auth, async (req, res) => {
  try {
    const postId = req.params.id;

    // paginazione base: ?page=1&limit=20
    const page  = parseInt(req.query.page, 10)  || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip  = (page - 1) * limit;

    const post = await Post.findById(postId)
      .select("authorId visibility isHidden moderation")
      .lean();

    if (
      !post ||
      post?.moderation?.isDeleted ||
      post?.isHidden === true ||
      post?.moderation?.status === "hidden"
    ) {
      return res.status(404).json({
        status: "error",
        code: "POST_NOT_FOUND",
        message: "Post not found",
      });
    }

    const g = await guardPostAccessForComments({
      meId: req.user._id,
      post,
      viewerAccountType: req.user?.accountType,
    });
    if (!g.ok) {
      return res.status(g.status).json({ status: "error", code: g.code, message: g.message });
    }

    const meId = req.user._id;

    const baseFilter = {
      postId,
      isDeleted: { $ne: true },
      $or: [
        { "moderation.status": "visible" },
        {
          authorId: meId,
          "moderation.status": { $in: ["visible", "under_review"] },
        },
      ],
    };

    const [items, total] = await Promise.all([
      Comment.find(baseFilter)
        .populate("authorId", "_id username displayName avatar")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Comment.countDocuments(baseFilter),
    ]);

    const meIdStr = String(req.user?._id || "");
    const accountType = String(req.user?.accountType || "").toLowerCase();
    const isAdmin = accountType === "admin" || req.user?.isAdmin === true;

    const safeItems = (items || []).map((c) => {
      const ownerId = c?.authorId?._id ? String(c.authorId._id) : String(c.authorId || "");
      const isOwner = ownerId && ownerId === meIdStr;

      return {
        ...c,
        canDelete: isAdmin || isOwner, // ✅ regola Fase 1 (owner qualunque + admin)
      };
    });

    return res.json({
      status: "success",
      page,
      limit,
      total,
      items: safeItems,
    });
  } catch (err) {
    console.error("Errore GET post comments:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during comment retrieval",
    });
  }
});

// DELETE /posts/:postId
// Soft delete with legal trace (owner or admin)
router.delete("/:postId", auth, async (req, res) => {
  try {
    const { postId } = req.params;
    const meId = String(req.user?._id || "");
    const isAdmin = String(req.user?.accountType || "").toLowerCase() === "admin";

    const post = await Post.findById(postId).select("_id authorId moderation.isDeleted").lean();
    if (!post) {
      return res.status(404).json({ status: "error", code: "POST_NOT_FOUND", message: "Post not found" });
    }

    const isOwner = String(post.authorId) === meId;
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ status: "error", code: "FORBIDDEN", message: "You can only delete your own posts" });
    }

    // idempotent
    if (post?.moderation?.isDeleted) {
      return res.json({ status: "success", deleted: true, alreadyDeleted: true });
    }

    const now = new Date();
    const deletedByRole = isAdmin ? "admin" : "owner";
    const deleteReason = isAdmin ? "admin_action" : "user_delete";

    const upd = await Post.updateOne(
      { _id: postId, "moderation.isDeleted": { $ne: true } },
      {
        $set: {
          "moderation.isDeleted": true,
          "moderation.deletedAt": now,
          "moderation.deletedBy": req.user._id,
          "moderation.deletedByRole": deletedByRole,
          "moderation.deleteReason": deleteReason,
        },
      }
    );

    // se per qualche motivo non modifica nulla, facciamo un check reale DB
    if (!upd || (upd.modifiedCount === 0 && upd.matchedCount === 0)) {
      return res.status(500).json({
        status: "error",
        code: "POST_DELETE_FAILED",
        message: "Internal error during post deletion",
      });
    }

    // ✅ legal audit (always)
    await ActionAuditLog.create({
      actorId: req.user._id,
      actorRole: isAdmin ? "admin" : "user",
      actionType: "POST_DELETE",
      targetType: "post",
      targetId: String(postId),
      reason: deleteReason,
      meta: { deletedByRole },
      ip: req.ip,
      userAgent: String(req.get("user-agent") || ""),
    });

    // ✅ admin audit (only if admin did it)
    if (isAdmin) {
      await AdminAuditLog.create({
        adminId: req.user._id,
        actionType: "POST_DELETE",
        targetType: "post",
        targetId: String(postId),
        meta: { reason: deleteReason || null },
      });
    }

    return res.json({ status: "success", deleted: true });
  } catch (err) {
    console.error("Error DELETE post:", err);
    return res.status(500).json({ status: "error", message: "Internal error during post deletion" });
  }
});

// DELETE /posts/:postId/comments/:commentId
// Cancella un commento se appartiene all'utente loggato
router.delete("/:postId/comments/:commentId", auth, async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user._id;

    // ✅ Guard access (block / followers-only / private / admin invisible)
    const post = await Post.findById(postId)
      .select("authorId visibility isHidden moderation")
      .lean();

    if (
      !post ||
      post?.moderation?.isDeleted ||
      post?.isHidden === true ||
      post?.moderation?.status === "hidden" ||
      post?.moderation?.status === "under_review"
    ) {
      return res.status(404).json({
        status: "error",
        code: "POST_NOT_FOUND",
        message: "Post not found",
      });
    }

    const g = await guardPostAccessForComments({
      meId: req.user._id,
      post,
      viewerAccountType: req.user?.accountType,
    });
    if (!g.ok) {
      return res.status(g.status).json({ status: "error", code: g.code, message: g.message });
    }

    const comment = await Comment.findById(commentId);

    if (!comment) {
      return res.status(404).json({
        status: "error",
        message: "Comment not found",
      });
    }

    // Controlliamo coerenza post + autore
    if (String(comment.postId) !== String(postId)) {
      return res.status(400).json({
        status: "error",
        message: "Comment does not belong to this post",
      });
    }

    const accountType = String(req.user?.accountType || "").toLowerCase();
    const isAdmin =
      accountType === "admin" ||
      accountType === "administrator" ||
      accountType === "superadmin" ||
      req.user?.isAdmin === true;
    const isOwner = String(comment.authorId) === String(userId);

    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        status: "error",
        message: "You are not allowed to delete this comment",
      });
    }

    // ✅ soft delete (mai deleteOne), idempotente
    const now = new Date();

    const upd = await Comment.updateOne(
      { _id: commentId, isDeleted: { $ne: true } },
      {
        $set: {
          isDeleted: true,
          deletedAt: now,
          deletedBy: userId,
          deletedByRole: isAdmin ? "admin" : "owner",
        },
      }
    );

    // decremento SOLO se realmente eliminato ora
    if (upd.modifiedCount > 0) {
      await Post.updateOne({ _id: postId }, { $inc: { commentCount: -1 } });
      await Post.updateOne(
        { _id: postId, commentCount: { $lt: 0 } },
        { $set: { commentCount: 0 } }
      );
    }

    return res.json({ status: "success", deleted: true });

  } catch (err) {
    console.error("Errore DELETE commento:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during comment deletion",
    });
  }
});

module.exports = router;