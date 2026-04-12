// routes/profile.routes.js
const express = require("express");
const router = express.Router();
const User = require("../models/user");
const auth = require("../middleware/authMiddleware");
const Follow = require("../models/Follow");
const { isUserBlockedEitherSide } = require("../utils/blockUtils");
const multer = require("multer");
const {
  uploadBufferToR2,
  buildObjectKey,
  makeScopedFilename,
  deleteFromR2ByUrl,
} = require("../services/r2MediaService");
const { maybeRenewVip } = require("../services/vipService");

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

function imageFileFilter(req, file, cb) {
  if (!ALLOWED_MIMES.has(file.mimetype)) {
    return cb(new Error("Only jpeg/png/webp allowed"));
  }
  cb(null, true);
}

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_IMAGE_SIZE },
}).single("avatar");

const uploadCover = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_IMAGE_SIZE },
}).single("cover");

// GET /api/profile/me  → dati profilo corrente
router.get("/me", auth, async (req, res) => {
  try {
    const meId = req.user._id;

    // 🔄 Lazy renew / normalize VIP (SERVER TIME)
    await maybeRenewVip(meId);

    const dbUser = await User.findById(meId)
      .select(
        [
          "_id",
          "displayName",
          "username",
          "emailVerifiedAt",
          "avatar",
          "coverImage",
          "bio",
          "area",
          "language",
          "languages",
          "profileType",
          "isVip",
          "vipExpiresAt",
          "vipAutoRenew",
          "vipSince",
          "isVerified",
          "verifiedUser",
          "verificationStatus",
          "verificationPublicVideoUrl",
          "isCreator",
          "accountType",
          "isPrivate",
          "interests",
          "interestsVip",
          "creatorEnabled",
          "creatorVerification",
          "payoutProvider",
          "payoutEnabled",
          "payoutStatus",
          "tokenInfoAcceptedAt",
          "tokenInfoAcceptedVersion",
        ].join(" ")
      )
      .lean();

    if (!dbUser) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const [followerCount, followingCount] = await Promise.all([
      Follow.countDocuments({ followingId: meId, status: "accepted" }),
      Follow.countDocuments({ followerId: meId, status: "accepted" }),
    ]);

    const profile = {
      ...dbUser,

      isVerified:
        dbUser.verifiedUser === true &&
        dbUser.verificationStatus === "approved",

      verifiedUser:
        dbUser.verifiedUser === true &&
        dbUser.verificationStatus === "approved",

      isCreator: dbUser.isCreator === true,

      isCreatorMonetizable:
        dbUser.isCreator === true &&
        dbUser.creatorEnabled === true &&
        dbUser.payoutProvider === "stripe" &&
        dbUser.payoutEnabled === true &&
        dbUser.payoutStatus === "verified",

      followerCount,
      followingCount,
    };

    return res.json({
      status: "ok",
      profile,
    });
  } catch (err) {
    console.error("Errore GET /api/profile/me:", err);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
});

// PUT /api/profile/update
router.put("/update", auth, async (req, res) => {
  try {
    const meId = req.user._id;
    const body = req.body || {};

    // campi che permettiamo di aggiornare
    const allowedFields = [
      "displayName",
      "profileType",
      "area",
      "bio",
      "interests",
      "language",
      "languages",
      "avatar",
      "coverImage",
      "isPrivate",

      // FEED
      "interestsBase",
      "interestsVip",
      "appSettings",
      "hasSeenTokenInfo",
    ];

    // raccogliamo gli aggiornamenti dal body
    const updates = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (!body || Object.keys(body).length === 0) {
      return res.status(400).json({ status: "error", message: "Empty payload." });
    }

    // hasSeenTokenInfo: can only be set to true (one-way)
    if ("hasSeenTokenInfo" in updates) {
      if (updates.hasSeenTokenInfo !== true) {
        return res.status(400).json({ status: "error", message: "hasSeenTokenInfo can only be true" });
      }
    }

    // if the update is ONLY for token info, skip profile-editor validations (like mandatory area)
    const isOnlyTokenInfo =
      Object.keys(updates).length === 1 && updates.hasSeenTokenInfo === true;

    // prima recuperiamo l'utente corrente, ci serve per capire se è vip/creator
    const currentUser = await User.findById(meId).select("accountType isVip language appSettings");

    if (!currentUser) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    // -------------------------
    // VALIDAZIONI PROFILO EDITOR
    // -------------------------

    // helper: normalizza codice lingua (trim + lowercase)
    const normalizeLang = (v) => (typeof v === "string" ? v.trim().toLowerCase() : v);

    // helper: valida formato "codice breve" (it, en, fr, es, de, pt, ecc.)
    const isValidLangCode = (code) => /^[a-z]{2,3}$/.test(code);

    // 1) area obbligatoria (nessuna preselezione) — BUT NOT for token-info-only updates
    if (!isOnlyTokenInfo) {
      if (!("area" in updates)) {
        return res.status(400).json({ status: "error", message: "mandatory area" });
      }

      if (typeof updates.area !== "string" || !updates.area.trim()) {
        return res.status(400).json({ status: "error", message: "mandatory area" });
      }

      updates.area = updates.area.trim();

      if (updates.area.length > 120) {
        return res.status(400).json({ status: "error", message: "area too long (max 120)" });
      }
    }

    // language opzionale (se presente: valida)
    if ("language" in updates) {
      updates.language = normalizeLang(updates.language);
      if (updates.language && !isValidLangCode(updates.language)) {
        return res.status(400).json({ status: "error", message: "Invalid language code" });
      }
    }

    // 2) languages[] (extra)
    if ("languages" in updates) {
      if (!Array.isArray(updates.languages)) {
        return res.status(400).json({
          status: "error",
          message: "languages ​​must be an array",
        });
      }

      // normalizza + filtra vuoti
      let extra = updates.languages
        .map(normalizeLang)
        .filter((x) => !!x);

      // valida formato
      for (const code of extra) {
        if (!isValidLangCode(code)) {
          return res.status(400).json({
            status: "error",
            message: "Invalid language code in languages",
          });
        }
      }

      // dedup
      extra = Array.from(new Set(extra));

      // max 5
      if (extra.length > 5) {
        return res.status(400).json({
          status: "error",
          message: "languages ​​can contain up to 5 extra languages",
        });
      }

      // non deve contenere primaria (usa quella nuova)
      if (extra.includes(updates.language)) {
        return res.status(400).json({
          status: "error",
          message: "languages cannot contain the primary language",
        });
      }

      updates.languages = extra;
    }

    // 3) avatar / coverImage: normalizza stringhe (accetta anche null)
    if ("avatar" in updates) {
      if (updates.avatar === null) {
        // ok
      } else if (typeof updates.avatar !== "string") {
        return res.status(400).json({ status: "error", message: "avatar not valid" });
      } else {
        updates.avatar = updates.avatar.trim();
      }
    }

    if ("coverImage" in updates) {
      if (updates.coverImage === null) {
        // ok
      } else if (typeof updates.coverImage !== "string") {
        return res.status(400).json({ status: "error", message: "coverImage not valid" });
      } else {
        updates.coverImage = updates.coverImage.trim();
      }
    }
    
    // =========================
    // FEED SETTINGS (v1)
    // =========================

    // interestsBase: sempre aggiornabile (array di stringhe)
    if ("interestsBase" in updates) {
      if (!Array.isArray(updates.interestsBase)) {
        return res.status(400).json({ status: "error", message: "interestsBase must be an array" });
      }
      updates.interestsBase = Array.from(
        new Set(updates.interestsBase.map((x) => String(x || "").trim()).filter(Boolean))
      ).slice(0, 50);
    }

    // interestsVip: SOLO VIP
    if ("interestsVip" in updates) {
      if (currentUser.isVip !== true) {
        return res.status(403).json({ status: "error", message: "Only VIPs can change interestsVip" });
      }
      if (!Array.isArray(updates.interestsVip)) {
        return res.status(400).json({ status: "error", message: "interestsVip must be an array" });
      }
      updates.interestsVip = Array.from(
        new Set(updates.interestsVip.map((x) => String(x || "").trim()).filter(Boolean))
      ).slice(0, 50);
    }

    // appSettings.contentContext: standard|neutral|live_events
    if ("appSettings" in updates) {
      const cc = updates?.appSettings?.contentContext;
      if (cc !== undefined) {
        if (!["standard", "neutral", "live_events"].includes(cc)) {
          return res.status(400).json({ status: "error", message: "contentContext not valid" });
        }
        updates.appSettings = {
          ...(currentUser.appSettings || {}),
          ...(updates.appSettings || {}),
          contentContext: cc,
        };
      } else {
        // non permettiamo update libero di appSettings (solo whitelist)
        delete updates.appSettings;
      }
    }

    // ora applichiamo gli aggiornamenti
    const user = await User.findByIdAndUpdate(meId, updates, {
      new: true,
      runValidators: true,
    }).select("-passwordHash");

    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    return res.json({
      status: "ok",
      profile: user,
    });
  } catch (err) {
    console.error("Errore PUT /api/profile/update:", err);

    // errori di validazione mongoose
    if (err.name === "ValidationError") {
      return res.status(400).json({
        status: "error",
        message: "Invalid data",
        details: err.message,
      });
    }

    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }

});

/**
 * @route   GET /api/profile/public/:id
 * @desc    Profilo pubblico utente + contatori follow
 * @access  Private (per ora; poi decidiamo se renderlo pubblico)
 */
router.get("/public/:id", auth, async (req, res) => {
  try {
    const targetUserId = req.params.id;

    if (!targetUserId || targetUserId.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "Invalid user ID",
      });
    }

    // Dati base utente (profilo pubblico)
    const user = await User.findById(targetUserId)
      .select(
        "_id displayName profileType area bio avatar coverImage interests language isVip verifiedUser isCreator creatorEnabled payoutProvider payoutEnabled payoutStatus createdAt verificationStatus verificationPublicVideoUrl isPrivate accountType status accountStatus isDeleted deletedAt deletionStatus"
      )
      .lean()
      .exec();

    if (!user) {
      return res.status(404).json({
        status: "error",
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    // 🔒 DELETED INVISIBLE (treat as not found)
    const isDeleted =
      user?.isDeleted === true ||
      !!user?.deletedAt ||
      String(user?.status || "").toLowerCase() === "deleted" ||
      String(user?.accountStatus || "").toLowerCase() === "deleted" ||
      String(user?.deletionStatus || "").toLowerCase() === "deleted";

    if (isDeleted) {
      return res.status(404).json({
        status: "error",
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    // 🔒 ADMIN INVISIBLE
    // Se target è admin, deve risultare "inesistente"
    if (user?.accountType === "admin") {
      return res.status(404).json({
        status: "error",
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    const meId = req.user?._id?.toString();

    // 🔒 BLOCK GUARD (either side) — prima di privacy
    if (meId) {
      const blocked = await isUserBlockedEitherSide(meId, user._id.toString());
      if (blocked) {
        return res.status(403).json({
          status: "error",
          code: "PROFILE_BLOCKED",
          message: "Profile not available",
        });
      }
    }

    // 🔐 PRIVACY: return profile header but lock content until accepted
    let followStatus = "none";
    let isLocked = false;

    const isAdminViewer = req.user?.accountType === "admin";

    if (
      !isAdminViewer &&
      String(meId) !== String(targetUserId) &&
      user.isPrivate === true
    ) {
      const rel = await Follow.findOne({
        followerId: meId,
        followingId: targetUserId,
      }).select("status").lean().exec();

      if (rel?.status === "pending") followStatus = "pending";
      if (rel?.status === "accepted") followStatus = "accepted";

      isLocked = followStatus !== "accepted";
    }

    if (isAdminViewer) {
      followStatus = "accepted";
      isLocked = false;
    }

    // ✅ Contatori follower/following SOLO accepted (no pending)
    const [followersCount, followingCount] = await Promise.all([
      Follow.countDocuments({ followingId: targetUserId, status: "accepted" }),
      Follow.countDocuments({ followerId: targetUserId, status: "accepted" }),
    ]);
    // ✅ VERIFICATION: single source of truth (output-normalized)
    const rawStatus = String(user?.verificationStatus || "none").toLowerCase();
    const rawUrl = String(user?.verificationPublicVideoUrl || "").trim();

    const isApproved = rawStatus === "approved" && !!rawUrl;

    const verificationStatus = isApproved
      ? "approved"
      : rawStatus === "pending"
      ? "pending"
      : "none";

    const verificationPublicVideoUrl = isApproved ? rawUrl : null;

    const verifiedUser = isApproved;

    const isVerified = isApproved;

    const isCreator = user?.isCreator === true;
    const isCreatorMonetizable =
      user?.isCreator === true &&
      user?.creatorEnabled === true &&
      user?.payoutProvider === "stripe" &&
      user?.payoutEnabled === true &&
      user?.payoutStatus === "verified";

    return res.status(200).json({
      status: "ok",
      message: "User profile recovered successfully",
      data: {
        ...user,

          // ✅ normalized flags
          isVerified,
          verifiedUser,
          isCreator,
          isCreatorMonetizable,

          // ✅ normalized verification fields
          verificationStatus,
          verificationPublicVideoUrl,

          followerCount: followersCount,
          followingCount,
          followStatus,
          isLocked,
      },
    });
  } catch (err) {
    console.error("Errore durante get profilo utente:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error during user profile recovery",
    });
  }
});

// GET /api/profile/status/me - stato account (base/vip/creator + token)
router.get("/status/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "_id accountType isVip isCreator creatorEnabled payoutProvider payoutEnabled payoutStatus verifiedUser verificationStatus verificationPublicVideoUrl tokenBalance tokenEarnings displayName avatar coverImage hasSeenTokenInfo"
    );

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    const isVIP = user.isVip === true;
    const isCreator = user.isCreator === true;
    const isVerified =
      user.verifiedUser === true &&
      user.verificationStatus === "approved";

    return res.json({
      status: "success",
      data: {
        id: user._id,
        accountType: user.accountType,
        isVIP,
        isCreator,
        isVerified,
        verifiedUser: isVerified,
        verificationStatus: user.verificationStatus,
        isCreatorMonetizable:
          user.isCreator === true &&
          user.creatorEnabled === true &&
          user.payoutProvider === "stripe" &&
          user.payoutEnabled === true &&
          user.payoutStatus === "verified",
        tokenBalance: user.tokenBalance,
        tokenEarnings: user.tokenEarnings,
        hasSeenTokenInfo: user.hasSeenTokenInfo === true,
        profile: {
          displayName: user.displayName,
          avatar: user.avatar,
          coverImage: user.coverImage,
        },
      },
    });
  } catch (err) {
    console.error("Errore GET /api/profile/status/me:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error",
    });
  }
});

// POST /api/profile/avatar (multipart/form-data, field: avatar)
router.post("/avatar", auth, (req, res) => {
  uploadAvatar(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ status: "error", message: err.message });

      const meId = String(req.user._id);
      if (!req.file) return res.status(400).json({ status: "error", message: "Missing avatar file" });

      const existing = await User.findById(meId).select("avatar").lean();

      const filename = makeScopedFilename("avatar", req.file.originalname, req.file.mimetype);
      const key = buildObjectKey({
        userId: meId,
        scope: "avatar",
        filename,
        folder: "avatar",
      });

      const uploaded = await uploadBufferToR2({
        key,
        body: req.file.buffer,
        contentType: req.file.mimetype,
        cacheControl: "public, max-age=31536000, immutable",
      });

      await User.findByIdAndUpdate(meId, { avatar: uploaded.url }, { new: true });

      if (existing?.avatar) {
        deleteFromR2ByUrl(existing.avatar).catch(() => {});
      }

      return res.json({ status: "ok", avatar: uploaded.url });
    } catch (e) {
      console.error("Errore POST /api/profile/avatar:", e);
      return res.status(500).json({ status: "error", message: "Internal server error" });
    }
  });
});

// POST /api/profile/cover (multipart/form-data, field: cover)
router.post("/cover", auth, (req, res) => {
  uploadCover(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ status: "error", message: err.message });

      const meId = String(req.user._id);
      if (!req.file) return res.status(400).json({ status: "error", message: "Missing cover file" });

      const existing = await User.findById(meId).select("coverImage").lean();

      const filename = makeScopedFilename("cover", req.file.originalname, req.file.mimetype);
      const key = buildObjectKey({
        userId: meId,
        scope: "cover",
        filename,
        folder: "cover",
      });

      const uploaded = await uploadBufferToR2({
        key,
        body: req.file.buffer,
        contentType: req.file.mimetype,
        cacheControl: "public, max-age=31536000, immutable",
      });

      await User.findByIdAndUpdate(meId, { coverImage: uploaded.url }, { new: true });

      if (existing?.coverImage) {
        deleteFromR2ByUrl(existing.coverImage).catch(() => {});
      }

      return res.json({ status: "ok", coverImage: uploaded.url });
    } catch (e) {
      console.error("Errore POST /api/profile/cover:", e);
      return res.status(500).json({ status: "error", message: "Errore interno del server" });
    }
  });
});

router.post("/token-info-accept", auth, async (req, res) => {
  try {
    const TOKEN_INFO_VERSION = 1;

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          tokenInfoAcceptedAt: new Date(),
          tokenInfoAcceptedVersion: TOKEN_INFO_VERSION,
        },
      },
      {
        new: true,
      }
    ).select("tokenInfoAcceptedAt tokenInfoAcceptedVersion");

    return res.json({
      status: "ok",
      data: {
        tokenInfoAcceptedAt: updated?.tokenInfoAcceptedAt || null,
        tokenInfoAcceptedVersion: updated?.tokenInfoAcceptedVersion || null,
      },
    });
  } catch (err) {
    console.error("POST /profile/token-info-accept error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error",
    });
  }
});

module.exports = router;
