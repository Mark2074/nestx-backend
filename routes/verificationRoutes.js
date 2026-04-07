const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const User = require("../models/user");
const Notification = require("../models/notification");
const CREATOR_TERMS_VERSION = "1.0";

// ===============================
// VERIFICHE UTENTE (NUOVO FLOW)
// Base path del file: /api/verification
// ===============================

/**
 * GET /api/verification/admin/:userId
 * Admin-only: returns minimal verification detail for the admin drawer.
 * Response (data):
 * - userId
 * - displayName
 * - verificationType: "profile" | "totem"
 * - verificationVideoUrl
 * - totemDescription (if any)
 * - notes (optional)
 */
router.get("/admin/:userId", authMiddleware, async (req, res) => {
  try {
    const adminId = req.user?.id;
    const { userId } = req.params || {};

    if (!adminId) return res.status(401).json({ status: "error", message: "Unauthorized" });
    if (!userId) return res.status(400).json({ status: "error", message: "userId required" });

    const admin = await User.findById(adminId).select("accountType").lean();
    if (!admin || admin.accountType !== "admin") {
      return res.status(403).json({ status: "error", message: "Forbidden" });
    }

    const user = await User.findById(userId)
      .select(
        "displayName username profileType verificationStatus verificationPublicVideoUrl verificationTotemStatus verificationTotemVideoUrl verificationTotemDescription"
      )
      .lean();

    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    const hasTotem = !!user.verificationTotemVideoUrl;
    const wantsTotem = user.verificationTotemStatus && user.verificationTotemStatus !== "none";

    // Choose the most relevant evidence. In Phase 1B we keep it minimal.
    let verificationType = "profile";
    let verificationVideoUrl = user.verificationPublicVideoUrl || null;

    if (wantsTotem && hasTotem) {
      // If a totem verification exists, expose it (it can still be reviewed manually)
      verificationType = "totem";
      verificationVideoUrl = user.verificationTotemVideoUrl || null;
    }

    return res.json({
      status: "success",
      data: {
        userId: String(userId),
        displayName: user.displayName || user.username || "",
        profileType: user.profileType || "",
        verificationType,
        verificationVideoUrl,
        totemDescription: user.verificationTotemDescription || "",
        notes: "",
      },
    });
  } catch (err) {
    console.error("GET /verification/admin/:userId error:", err);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
});

/**
 * POST /api/verification/profile
 * Invio/Reinvio verifica profilo (solo profilo)
 * body: { publicVideoUrl }
 */
router.post("/profile", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { publicVideoUrl } = req.body || {};

    if (!publicVideoUrl || typeof publicVideoUrl !== "string") {
      return res.status(400).json({ status: "error", message: "publicVideoUrl required" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    user.verificationStatus = "pending";
    user.verificationPublicVideoUrl = publicVideoUrl;
    user.verifiedUser = false;

    await user.save();

    // 🔔 Admin queue unica: una sola notification (userId: null)
    try {
      await Notification.create({
        userId: null,
        actorId: user._id,
        type: "ADMIN_PROFILE_VERIFICATION_PENDING",
        targetType: "user",
        targetId: user._id,
        message: `New profile verification request from ${user.displayName || "user"}.`,
        data: {
          userId: String(user._id),
          displayName: user.displayName || "",
          profileType: user.profileType || "",
        },
        isPersistent: false,
        dedupeKey: `admin:verify:${user._id}:profile:pending`,
      });
    } catch (e) {
      if (e?.code !== 11000) console.error("Admin notification profile pending error:", e);
    }

    return res.json({
      status: "success",
      message: "Profile verification request sent",
      data: { verificationStatus: user.verificationStatus },
    });
  } catch (err) {
    console.error("Errore POST /verification/profile:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * GET /api/verification/profile/status
 */
router.get("/profile/status", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;

    const user = await User.findById(userId)
      .select("verificationStatus verifiedUser verificationPublicVideoUrl")
      .lean();

    if (!user)
      return res.status(404).json({ status: "error", message: "User not found" });

    return res.json({
      status: "success",
      data: {
        verificationStatus: user.verificationStatus || "none",
        verifiedUser: !!user.verifiedUser,
        verificationPublicVideoUrl:
          user.verificationStatus === "approved"
            ? user.verificationPublicVideoUrl
            : null,
      },
    });
  } catch (err) {
    console.error("GET /verification/profile/status error:", err);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
});

/**
 * POST /api/verification/totem
 * Invio/Reinvio verifica totem (solo totem)
 * body: { totemVideoUrl, totemDescription }
 */
router.post("/totem", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { totemVideoUrl, totemDescription } = req.body || {};

    if (!totemVideoUrl || typeof totemVideoUrl !== "string") {
      return res.status(400).json({ status: "error", message: "totemVideoUrl required" });
    }
    if (!totemDescription || typeof totemDescription !== "string") {
      return res.status(400).json({ status: "error", message: "totemDescription required" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    user.verificationTotemStatus = "pending";
    user.verificationTotemVideoUrl = totemVideoUrl;
    user.verificationTotemDescription = totemDescription;

    await user.save();

    // 🔔 Notifica admin: nuova verifica totem pending (dedupe safe)
    try {
      const admins = await User.find({ accountType: "admin" }).select("_id").lean();
      if (admins.length) {
        await Notification.insertMany(
          admins.map(a => ({
            userId: a._id,
            actorId: user._id,
            type: "ADMIN_TOTEM_VERIFICATION_PENDING",
            targetType: "user",
            targetId: user._id,
            message: `New totem verification request from ${user.displayName || "user"}.`,
            data: {
              userId: String(user._id),
              displayName: user.displayName || "",
              totemDescription: user.verificationTotemDescription || "",
            },
            isPersistent: false,
            dedupeKey: `admin:verif:totem:${user._id}:pending`,
          })),
          { ordered: false }
        );
      }
    } catch (e) {
      if (e?.code !== 11000) console.error("Admin notification totem pending error:", e);
    }

    return res.json({
      status: "success",
      message: "Profile verification request sent",
      data: { verificationTotemStatus: user.verificationTotemStatus },
    });
  } catch (err) {
    console.error("Errore POST /verification/totem:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * GET /api/verification/totem/status
 */
router.get("/totem/status", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;

    const user = await User.findById(userId).select("verificationTotemStatus").lean();
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    return res.json({
      status: "success",
      data: { verificationTotemStatus: user.verificationTotemStatus || "none" },
    });
  } catch (err) {
    console.error("Errore GET /verification/totem/status:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * POST /api/verification/creator/request
 * body: { videoDeclarationUrl, declaredOver18, acceptedCreatorTermsVersion }
 */
router.post("/creator/request", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { over18, acceptTerms, note } = req.body || {};
    const now = new Date();

    if (over18 !== true) {
      return res.status(400).json({ status: "error", message: "over18 must be true" });
    }
    if (acceptTerms !== true) {
      return res.status(400).json({ status: "error", message: "acceptTerms must be true" });
    }

    const noteClean = typeof note === "string" ? note.trim().slice(0, 500) : "";

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    if (user.accountType === "admin") {
      return res.status(403).json({
        status: "error",
        message: "Admins cannot become creators",
      });
    }

    // already approved -> idempotent
    if (user.creatorVerification?.status === "approved") {
      return res.json({
        status: "success",
        message: "Creator already approved",
        data: { creatorVerificationStatus: "approved" },
      });
    }

    user.creatorVerification = user.creatorVerification || {};

    user.creatorVerification.status = "pending";

    // Dedicated 18+ declaration for Creator role
    user.creatorVerification.declaredOver18 = true;
    user.creatorVerification.declaredOver18At = now;

    // Creator Terms acceptance (versioned)
    user.creatorVerification.acceptedCreatorTermsVersion = CREATOR_TERMS_VERSION;
    user.creatorVerification.acceptedCreatorTermsAt = now;

    // Optional note
    user.creatorVerification.note = noteClean || null;

    user.creatorVerification.submittedAt = now;

    await user.save();

    // 🔔 Admin notification (single queue item, dedupe)
    try {
      await Notification.create({
        userId: null,
        actorId: user._id,
        type: "ADMIN_CREATOR_VERIFICATION_PENDING",
        targetType: "user",
        targetId: user._id,
        message: `New creator request from ${user.displayName || "user"}.`,
        data: {
          userId: String(user._id),
          displayName: user.displayName || "",
          profileType: user.profileType || "",
        },
        isPersistent: false,
        dedupeKey: `admin:creator:${user._id}:pending`,
      });
    } catch (e) {
      if (e?.code !== 11000) console.error("Admin notification creator pending error:", e);
    }

    return res.json({
      status: "success",
      message: "Creator request sent",
      data: { creatorVerificationStatus: user.creatorVerification.status },
    });
  } catch (err) {
    console.error("POST /verification/creator/request error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * GET /api/verification/creator/status
 */
router.get("/creator/status", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id;

    const user = await User.findById(userId)
      .select("accountType isCreator creatorVerification.status creatorVerification.videoDeclarationUrl")
      .lean();

    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    return res.json({
      status: "success",
      data: {
        creatorVerificationStatus: user.creatorVerification?.status || "none",
        isCreator: user.accountType === "creator" || user.isCreator === true,
        videoDeclarationUrl:
          user.creatorVerification?.status === "approved" ? user.creatorVerification?.videoDeclarationUrl || null : null,
      },
    });
  } catch (err) {
    console.error("GET /verification/creator/status error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
