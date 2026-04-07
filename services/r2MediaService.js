const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");

function trimSlashStart(v) {
  return String(v || "").replace(/^\/+/, "");
}

function trimSlashEnd(v) {
  return String(v || "").replace(/\/+$/, "");
}

function getRequiredEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

function getR2Client() {
  const accountId = getRequiredEnv("R2_ACCOUNT_ID");
  const accessKeyId = getRequiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getRequiredEnv("R2_SECRET_ACCESS_KEY");

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

function getBucketName() {
  return getRequiredEnv("R2_BUCKET");
}

function getPublicBaseUrl() {
  return trimSlashEnd(getRequiredEnv("R2_PUBLIC_BASE_URL"));
}

function inferContentTypeFromName(filename, fallback = "application/octet-stream") {
  const lower = String(filename || "").toLowerCase();

  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mkv")) return "video/x-matroska";

  return fallback;
}

function buildObjectKey({ userId, scope, filename, folder = null }) {
  const safeUserId = String(userId || "").trim();
  const safeScope = String(scope || "").trim();
  const safeFilename = String(filename || "").trim();

  const parts = ["users", safeUserId];

  if (folder) {
    parts.push(String(folder).trim());
  } else {
    parts.push(safeScope);
  }

  parts.push(safeFilename);

  return parts.filter(Boolean).join("/");
}

function buildPublicUrl(key) {
  return `${getPublicBaseUrl()}/${trimSlashStart(key)}`;
}

async function uploadBufferToR2({
  key,
  body,
  contentType,
  cacheControl = "public, max-age=31536000, immutable",
}) {
  const client = getR2Client();
  const bucket = getBucketName();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
      CacheControl: cacheControl,
    })
  );

  return {
    key,
    url: buildPublicUrl(key),
  };
}

async function deleteFromR2ByUrl(url) {
  const base = getPublicBaseUrl();
  const bucket = getBucketName();
  const client = getR2Client();

  const safeUrl = String(url || "").trim();
  if (!safeUrl) return false;
  if (!safeUrl.startsWith(base + "/")) return false;

  const key = trimSlashStart(safeUrl.slice(base.length + 1));
  if (!key) return false;

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  return true;
}

function makeScopedFilename(scope, originalName, mimeType) {
  const extMap = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-matroska": ".mkv",
  };

  const inferredExt =
    extMap[String(mimeType || "").toLowerCase()] ||
    (() => {
      const name = String(originalName || "");
      const idx = name.lastIndexOf(".");
      return idx >= 0 ? name.slice(idx).toLowerCase() : "";
    })() ||
    "";

  return `${scope}_${Date.now()}_${crypto.randomUUID()}${inferredExt}`;
}

module.exports = {
  inferContentTypeFromName,
  buildObjectKey,
  buildPublicUrl,
  uploadBufferToR2,
  deleteFromR2ByUrl,
  makeScopedFilename,
};