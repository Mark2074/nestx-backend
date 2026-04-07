const express = require("express");
const router = express.Router();
const multer = require("multer");
const authMiddleware = require("../middleware/authMiddleware");

const { execFile } = require("child_process");
const ffprobePath = require("ffprobe-static")?.path;

const {
  uploadBufferToR2,
  buildObjectKey,
  makeScopedFilename,
} = require("../services/r2MediaService");

function getUploadScope(req) {
  const raw = String(req.query?.scope || req.body?.scope || "post").toLowerCase();
  return ["verification", "avatar", "cover", "post", "showcase", "event", "adv"].includes(raw)
    ? raw
    : "post";
}

function fileFilter(req, file, cb) {
  const mime = String(file.mimetype || "").toLowerCase();
  const scope = getUploadScope(req);

  if (scope === "verification") {
    if (!mime.startsWith("video/")) return cb(new Error("Only video files are allowed"));
    return cb(null, true);
  }

  if (["post", "event", "adv", "showcase"].includes(scope)) {
    if (!mime.startsWith("image/") && !mime.startsWith("video/")) {
      return cb(new Error("Only image or video files are allowed"));
    }
    return cb(null, true);
  }

  if (!mime.startsWith("image/")) return cb(new Error("Only image files are allowed"));
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: 80 * 1024 * 1024,
  },
});

function ffprobeDurationSecondsFromBuffer(buffer, originalName = "upload.bin") {
  return new Promise((resolve, reject) => {
    if (!ffprobePath) return reject(new Error("FFPROBE_NOT_AVAILABLE"));

    const os = require("os");
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");

    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `nestx_${Date.now()}_${crypto.randomUUID()}_${originalName}`);

    fs.writeFileSync(tmpFile, buffer);

    execFile(
      ffprobePath,
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        tmpFile,
      ],
      (err, stdout) => {
        try {
          fs.unlinkSync(tmpFile);
        } catch (_) {}

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

  const duration = await ffprobeDurationSecondsFromBuffer(file.buffer, file.originalname || "upload.bin");

  if (duration > maxSeconds) {
    const msgBase = "Video is too long. Max duration is 1 minute (VIP can upload up to 3 minutes).";
    const msgVip = "Video is too long. Max duration is 3 minutes.";

    const err = new Error(isVip ? msgVip : msgBase);
    err.statusCode = 400;
    throw err;
  }
}

router.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: "error", message: "Missing file" });
    }

    try {
      await enforcePostVideoDuration(req, req.file);
    } catch (e) {
      const code = e?.statusCode || 500;
      return res.status(code).json({ status: "error", message: e?.message || "Upload failed" });
    }

    const userId = String(req.user?._id || req.user?.id || "unknown");
    const scope = getUploadScope(req);
    const mimeType = String(req.file.mimetype || "").toLowerCase();

    const filename = makeScopedFilename(scope, req.file.originalname, mimeType);

    const folder =
      scope === "post"
        ? "posts"
        : scope === "event"
        ? "events"
        : scope === "adv"
        ? "adv"
        : scope === "showcase"
        ? "showcase"
        : scope;

    const key = buildObjectKey({
      userId,
      scope,
      filename,
      folder,
    });

    const uploaded = await uploadBufferToR2({
      key,
      body: req.file.buffer,
      contentType: mimeType || "application/octet-stream",
    });

    return res.json({
      status: "success",
      data: {
        url: uploaded.url,
        key: uploaded.key,
      },
    });
  } catch (err) {
    console.error("POST /api/media/upload error:", err);
    return res.status(500).json({ status: "error", message: "Upload failed" });
  }
});

module.exports = router;