// mediaRoutes.js
const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const authMiddleware = require("../middleware/authMiddleware");

const { execFile } = require("child_process");
const ffprobePath = require("ffprobe-static")?.path;

// DEV storage root (prefer env, fallback backend/uploads)
function getUploadsDir() {
  const p = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(process.cwd(), "uploads");
  return p;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function publicBaseUrl(req) {
  // In prod useremo env (vincolante). In dev fallback.
  const fromEnv = String(process.env.APP_PUBLIC_BASE_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  return `${proto}://${req.get("host")}`;
}

function getUploadScope(req) {
  const raw = String(req.query?.scope || req.body?.scope || "post").toLowerCase();
  return ["verification", "avatar", "cover", "post", "showcase"].includes(raw) ? raw : "post";
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = String(req.user?.id || "unknown");
    const root = getUploadsDir();
    const scope = getUploadScope(req);
    const dir = scope === "post"
      ? path.join(root, "users", userId, "posts")
      : path.join(root, "users", userId, scope);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const scope = getUploadScope(req);

    const allowedVideo = [".mp4", ".mov", ".webm", ".mkv"];
    const allowedImg = [".jpg", ".jpeg", ".png", ".webp"];

    const mime = String(file.mimetype || "").toLowerCase();
    const isVideo = mime.startsWith("video/");

    let safeExt = ext;

    if (scope === "verification") {
      if (!allowedVideo.includes(safeExt)) safeExt = ".mp4";
    } else if (scope === "post") {
      if (isVideo) {
        if (!allowedVideo.includes(safeExt)) safeExt = ".mp4";
      } else {
        if (!allowedImg.includes(safeExt)) safeExt = ".jpg";
      }
    } else {
      // avatar/cover
      if (!allowedImg.includes(safeExt)) safeExt = ".jpg";
    }

    const name = `${scope}_${Date.now()}${safeExt}`;
    cb(null, name);
  },
});

function fileFilter(req, file, cb) {
  const mime = String(file.mimetype || "").toLowerCase();
  const scope = getUploadScope(req);

  if (scope === "verification") {
    if (!mime.startsWith("video/")) return cb(new Error("Only video files are allowed"));
    return cb(null, true);
  }

  if (scope === "post") {
    if (!mime.startsWith("image/") && !mime.startsWith("video/")) {
      return cb(new Error("Only image or video files are allowed"));
    }
    return cb(null, true);
  }

  // avatar/cover
  if (!mime.startsWith("image/")) return cb(new Error("Only image files are allowed"));
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 80 * 1024 * 1024, // 80MB (dev)
  },
});

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
        const s = String(stdout || "").trim();
        const n = Number.parseFloat(s);
        if (!Number.isFinite(n)) return reject(new Error("FFPROBE_INVALID_DURATION"));
        resolve(n);
      }
    );
  });
}

async function enforcePostVideoDuration(req, file) {
  const scope = getUploadScope(req);
  const mime = String(file?.mimetype || "").toLowerCase();
  const isVideo = mime.startsWith("video/");

  if (scope !== "post" || !isVideo) return;

  const isVip = !!req.user?.isVip;
  const maxSeconds = isVip ? 180 : 60;

  const duration = await ffprobeDurationSeconds(file.path);

  if (duration > maxSeconds) {
    try { fs.unlinkSync(file.path); } catch (_) {}

    const msgBase = "Video is too long. Max duration is 1 minute (VIP can upload up to 3 minutes).";
    const msgVip = "Video is too long. Max duration is 3 minutes.";

    const err = new Error(isVip ? msgVip : msgBase);
    err.statusCode = 400;
    throw err;
  }
}

/**
 * POST /api/media/upload
 * form-data: file=<video>
 * returns: { status:"success", data:{ url } }
 */
router.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: "error", message: "Missing file" });
    }

    // ✅ enforce duration for post videos (Base/VIP)
    try {
      await enforcePostVideoDuration(req, req.file);
    } catch (e) {
      const code = e?.statusCode || 500;
      return res.status(code).json({ status: "error", message: e?.message || "Upload failed" });
    }

    // Build public URL...

    // Build public URL: /uploads/users/<id>/verification/<filename>
    const userId = String(req.user?.id || "unknown");
    const scope = getUploadScope(req);
    const rel = (scope === "post"
      ? `users/${userId}/posts/${req.file.filename}`
      : `users/${userId}/${scope}/${req.file.filename}`
    ).replace(/\\/g, "/");
    const url = `${publicBaseUrl(req)}/uploads/${rel}`;

    return res.json({ status: "success", data: { url } });
  } catch (err) {
    console.error("POST /api/media/upload error:", err);
    return res.status(500).json({ status: "error", message: "Upload failed" });
  }
});

module.exports = router;
