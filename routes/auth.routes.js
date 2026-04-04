const express = require('express');
const authMiddleware = require("../middleware/authMiddleware");
const User = require('../models/user');
const AgeGateLog = require("../models/ageGateLog");

const router = express.Router();
const jwt = require('jsonwebtoken');

const crypto = require("crypto");
const nodemailer = require("nodemailer");
const AdminAuditLog = require("../models/AdminAuditLog");

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).trim();
  return req.ip || null;
}

async function logAdminLogin(req, adminId, emailNorm) {
  try {
    await AdminAuditLog.create({
      adminId,
      actionType: "ADMIN_LOGIN",
      targetType: "system",
      targetId: "login",
      meta: {
        email: emailNorm || null,
        ip: getClientIp(req),
        userAgent: (req.headers["user-agent"] || "").toString().slice(0, 500) || null,
      },
    });
  } catch (e) {
    console.error("AdminAuditLog (ADMIN_LOGIN) write failed:", e?.message || e);
  }
}

// -----------------------------
// Helpers token/hash + time
// -----------------------------
function makeRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}
function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function publicUploadsUrl(p) {
  if (!p || typeof p !== "string") return p;
  if (!p.startsWith("/uploads/")) return p;

  const base = String(process.env.APP_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!base) return p; // in dev può restare relativo, in prod base deve esistere
  return `${base}${p}`;
}

// -----------------------------
// Frontend base URL (for email links)
// -----------------------------
function getFrontendBaseUrl(req) {
  const envUrl = process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL;
  if (envUrl) return String(envUrl).replace(/\/$/, "");
  // fallback dev
  return "http://localhost:5173";
}

// -----------------------------
// SMTP (dev-safe)
// -----------------------------
function isSmtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM);
}

async function sendMail({ to, subject, html }) {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const mailDisabled = String(process.env.MAIL_DISABLE || "").toLowerCase() === "true";

  // In produzione MAIL_DISABLE è vietato
  if (isProd && mailDisabled) {
    throw new Error("MAIL_DISABLED_IN_PRODUCTION");
  }

  // DEV hard-disable
  if (mailDisabled) {
    console.log("📧 [DEV] MAIL_DISABLE=true → email NON inviata");
    console.log("TO:", to);
    console.log("SUBJECT:", subject);
    return { ok: true, dev: true };
  }

  // SMTP obbligatorio in produzione
  if (!isSmtpConfigured()) {
    if (isProd) {
      throw new Error("SMTP_NOT_CONFIGURED");
    }

    console.log("📧 [DEV] SMTP non configurato → email NON inviata");
    console.log("TO:", to);
    console.log("SUBJECT:", subject);
    return { ok: true, dev: true };
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject,
    html,
  });

  return { ok: true };
}

// ✅ segreto per il JWT (prende prima JWT_SECRET, se non c'è prova con JVT_SECRET, altrimenti uno di default)
const JWT_SECRET = process.env.JWT_SECRET || process.env.JVT_SECRET || 'nestx_dev_secret';

// --------------------------------------------------
// ROTTA DI TEST
// --------------------------------------------------
router.get('/test', (req, res) => {
  res.json({
    status: 'ok',
    scope: 'auth',
    message: 'Auth routes attive'
  });
});

// --------------------------------------------------
// REGISTRAZIONE: POST /api/auth/register
// body: { email, password, displayName }
// --------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    const {
      email,
      password,
      displayName,
      dateOfBirth,
      profileType,
      area,
      bio,
      language,
    } = req.body;
    const emailNorm = String(email).trim().toLowerCase();

    if (!email || !password || !displayName || !dateOfBirth) {
      return res.status(400).json({
        status: "error",
        message: "Email, password, displayName and dateOfBirth are required.",
      });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 8 characters.",
      });
    }

    if (typeof area !== "string" || !area.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Area is required.",
      });
    }

    if (area.trim().length > 120) {
      return res.status(400).json({
        status: "error",
        message: "Area is too long (max 120).",
      });
    }

    if (bio != null && String(bio).length > 500) {
      return res.status(400).json({
        status: "error",
        message: "Bio is too long (max 500).",
      });
    }

    if (language != null && String(language).trim()) {
      const langNorm = String(language).trim().toLowerCase();
      if (!/^[a-z]{2,3}$/.test(langNorm)) {
        return res.status(400).json({
          status: "error",
          message: "Language code is invalid.",
        });
      }
    }

    // Controllo se esiste già
    const existing = await User.findOne({ email: emailNorm });
    if (existing) {
      return res.status(409).json({
        status: 'error',
        message: "User already registered.",
      });
    }

    // -------------------------------
    // DOB check (>= 18) + log tentativi underage
    // -------------------------------
    function parseDobString(dobStr) {
      // accetta "YYYY-MM-DD"
      if (typeof dobStr !== "string") return null;
      const m = dobStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      // validazione forte: stessa data dopo costruzione
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== (mo - 1) || dt.getUTCDate() !== d) return null;
      return { y, mo, d, date: dt, dobString: `${m[1]}-${m[2]}-${m[3]}` };
    }

    function isAdult18(dob) {
      // confronto in UTC per evitare edge timezone
      const now = new Date();
      const nowY = now.getUTCFullYear();
      const nowM = now.getUTCMonth() + 1;
      const nowD = now.getUTCDate();

      let age = nowY - dob.y;
      if (nowM < dob.mo || (nowM === dob.mo && nowD < dob.d)) age -= 1;
      return age >= 18;
    }
    
    const dobParsed = parseDobString(dateOfBirth);
    if (!dobParsed) {
      await AgeGateLog.findOneAndUpdate(
        { email: emailNorm },
        {
          $setOnInsert: { email: emailNorm },
          $inc: { failedUnderageAttempts: 1 },
          $set: { lastUnderageAttemptAt: new Date() }
        },
        { upsert: true, new: true }
      );

      return res.status(400).json({
        status: "error",
        message: "dateOfBirth invalid (required format: YYYY-MM-DD)"
      });
    }

    if (!isAdult18(dobParsed)) {
      // upsert log per email
      await AgeGateLog.findOneAndUpdate(
        { email: emailNorm },
        {
          $setOnInsert: { email: emailNorm, firstDobString: dobParsed.dobString },
          $inc: { failedUnderageAttempts: 1 },
          $set: { lastUnderageAttemptAt: new Date() }
        },
        { upsert: true, new: true }
      );

      return res.status(403).json({
        status: "error",
        message: "The site is not authorized for minors."
      });
    }

    // Hash della password
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash(password, 10);

    // Creazione utente
    const profileTypeNorm = ["male", "female", "couple", "gay", "trans"].includes(String(profileType || "").trim().toLowerCase())
      ? String(profileType).trim().toLowerCase()
      : "male";

    const areaNorm = String(area || "").trim();
    const bioNorm = String(bio || "").trim();
    const languageNorm = String(language || "").trim().toLowerCase();

    const newUser = await User.create({
      email: emailNorm,
      passwordHash,
      displayName: String(displayName || "").trim(),
      dateOfBirth: dobParsed.date,

      adultConsentAt: req.body?.adultConsent === true ? new Date() : null,

      profileType: profileTypeNorm,
      area: areaNorm,
      bio: bioNorm,
      language: languageNorm,

      accountType: "base",
      isCreator: false,
    });

    await AgeGateLog.updateOne(
      { email: emailNorm, userId: null },
      {
        $set: {
          userId: newUser._id,
          linkedAt: new Date(),
          status: "linked",
          successDobString: dobParsed.dobString,
        },
      }
    );

    // ---- Email verify token (Phase 1) ----
    const verifyToken = makeRandomToken(32);
    const verifyTokenHash = sha256(verifyToken);
    const verifyExpiresAt = addMinutes(new Date(), 60);

    await User.updateOne(
      { _id: newUser._id },
      { $set: { emailVerifyTokenHash: verifyTokenHash, emailVerifyExpiresAt: verifyExpiresAt, emailVerifiedAt: null } }
    );

    const base = process.env.FRONTEND_BASE_URL || "http://localhost:5173";
    const verifyLink = `${base}/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;
    console.log("🔗 VERIFY EMAIL LINK:", verifyLink);

    await sendMail({
      to: newUser.email,
      subject: "NestX — Verify your email",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <p>Please verify your email to unlock NestX features.</p>
          <p><a href="${verifyLink}">Verify email</a></p>
          <p>This link expires in 60 minutes.</p>
          <p>If you did not create this account, ignore this email.</p>
        </div>
      `,
    });

    return res.status(201).json({
      status: "ok",
      message: "Registration completed. Please verify your email before logging in.",
      user: {
        id: newUser._id,
        email: newUser.email,
        displayName: newUser.displayName,
        accountType: newUser.accountType,
        emailVerifiedAt: null,
      },
    });
  } catch (err) {
    console.error('Errore in /register:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Internal error during registration',
    });
  }
});

// --------------------------------------------------
// LOGIN: POST /api/auth/login
// body: { email, password }
// --------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const emailNorm = String(email || "").trim().toLowerCase();

    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Email and password are required',
      });
    }

    const user = await User.findOne({ email: emailNorm });
    if (!user) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid credentials',
      });
    }

    const bcrypt = require('bcrypt');
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid credentials',
      });
    }

    // ------------------------------
    // ACCOUNT STATE CHECK (I5)
    // ------------------------------

    // deleted
    if (user.isDeleted === true) {
      return res.status(403).json({
        status: "error",
        code: "ACCOUNT_DELETED",
        message: "Account deleted.",
      });
    }

    // banned
    if (user.isBanned === true) {
      return res.status(403).json({
        status: "error",
        code: "ACCOUNT_BANNED",
        message: "Account banned.",
      });
    }

    // suspended (attivo)
    if (user.isSuspended === true) {
      const until = user.suspendedUntil ? new Date(user.suspendedUntil).getTime() : 0;
      const now = Date.now();

      if (until && now < until) {
        return res.status(403).json({
          status: "error",
          code: "ACCOUNT_SUSPENDED",
          message: "Account suspended.",
          suspendedUntil: user.suspendedUntil || null,
        });
      }
    }

    // opzionale ma consigliato per coerenza forte:
    if (!user.emailVerifiedAt) {
      return res.status(403).json({
        status: "error",
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Please verify your email before logging in.",
      });
    }

    const token = jwt.sign(
      { userId: user._id, tokenVersion: user.tokenVersion || 0 },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    if (user.accountType === "admin") {
      await logAdminLogin(req, user._id, emailNorm);
    }

    return res.json({
      status: 'ok',
      message: 'Login completed',
      needsAdultConsent: !user.adultConsentAt,
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        profileType: user.profileType,
        accountType: user.accountType,
        isVip: user.isVip,
        isCreator: user.isCreator,
        createdAt: user.createdAt,
        verifiedUser: user.verifiedUser,
        verificationStatus: user.verificationStatus,
        verificationPublicVideoUrl: user.verificationPublicVideoUrl,
        emailVerifiedAt: user.emailVerifiedAt,
        payoutProvider: user.payoutProvider,
        avatar: publicUploadsUrl(user.avatar),
        coverImage: publicUploadsUrl(user.coverImage),
        payoutAccountId: user.payoutAccountId,
        payoutEnabled: user.payoutEnabled,
        payoutStatus: user.payoutStatus
      }
    });
  } catch (err) {
    console.error('Errore in /login:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Internal error during login',
    });
  }
});

// --------------------------------------------------
// ROTTA PROTETTA: GET /api/auth/me
// (richiede header Authorization: Bearer <token>)
// --------------------------------------------------
// Assicurati che in alto nel file ci sia:
// const User = require('../models/User');

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = req.user; // già DB completo
    return res.json({
      status: "ok",
      user: {
        id: user._id,
        displayName: user.displayName,
        profileType: user.profileType,
        area: user.area,
        bio: user.bio,
        avatar: publicUploadsUrl(user.avatar),
        coverImage: publicUploadsUrl(user.coverImage),
        interests: user.interests,
        language: user.language,
        languages: user.languages,
        isVip: user.isVip,
        verifiedUser: user.verifiedUser,
        isCreator: user.isCreator,
        createdAt: user.createdAt,
        verificationStatus: user.verificationStatus,
        verificationPublicVideoUrl: user.verificationPublicVideoUrl,
        emailVerifiedAt: user.emailVerifiedAt,
        // --- MODERATION / ACCOUNT STATUS ---
        isSuspended: user.isSuspended === true,
        suspendedUntil: user.suspendedUntil || null,
        suspendReason: user.suspendReason || null,

        isBanned: user.isBanned === true,
        bannedAt: user.bannedAt || null,
        banReason: user.banReason || null,
      },
    });
  } catch (err) {
    console.error("Errore /me:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// --------------------------------------------------
// POST /api/auth/adult-consent
// Registra consenso + sblocca accesso piattaforma
// --------------------------------------------------
router.post("/adult-consent", authMiddleware, async (req, res) => {
  try {
    // se già accettato, ok idempotente
    if (req.user.adultConsentAt) {
      return res.json({ status: "ok", message: "Consent already registered", adultConsentAt: req.user.adultConsentAt });
    }

    const now = new Date();
    await User.updateOne({ _id: req.user._id }, { $set: { adultConsentAt: now } });

    return res.json({ status: "ok", message: "Consent registered", adultConsentAt: now });
  } catch (err) {
    console.error("Errore adult-consent:", err);
    return res.status(500).json({ status: "error", message: "Internal error during adult consent" });
  }
});

// POST /api/auth/logout-all
router.post("/logout-all", authMiddleware, async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    return res.json({ status: "ok", message: "Global logout completed" });
  } catch (err) {
    console.error("Errore logout-all:", err);
    return res.status(500).json({ status: "error", message: "Internal error during logout-all" });
  }
});

// --------------------------------------------------
// DELETE /api/auth/account
// Self-delete account: marks as deleted + revokes session
// --------------------------------------------------
router.delete("/account", authMiddleware, async (req, res) => {
  try {
    const now = new Date();

    // idempotente: se già deleted, assicura revoke + ritorna ok
    await User.updateOne(
      { _id: req.user._id },
      {
        $set: { isDeleted: true, deletedAt: now },
        $inc: { tokenVersion: 1 }, // revoke immediato
      }
    );

    return res.json({
      status: "ok",
      message: "Account deleted request accepted.",
      deletedAt: now,
    });
  } catch (err) {
    console.error("Errore DELETE /account:", err);
    return res.status(500).json({ status: "error", message: "Internal error during account deletion" });
  }
});

// POST /api/auth/change-password
router.post("/change-password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ status: "error", message: "currentPassword and newPassword are required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ status: "error", message: "newPassword too short (min 8)" });
    }

    const bcrypt = require("bcrypt");

    const ok = await bcrypt.compare(currentPassword, req.user.passwordHash);
    if (!ok) {
      return res.status(401).json({ status: "error", message: "Invalid current password" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await User.updateOne(
      { _id: req.user._id },
      { $set: { passwordHash }, $inc: { tokenVersion: 1 } } // ✅ revoke globale automatico
    );

    return res.json({ status: "ok", message: "Password updated" });
  } catch (err) {
    console.error("Errore change-password:", err);
    return res.status(500).json({ status: "error", message: "Internal error during change-password" });
  }
});

// --------------------------------------------------
// PASSWORD RESET: POST /api/auth/forgot-password
// body: { email }
// --------------------------------------------------
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const emailNorm = String(email || "").trim().toLowerCase();

    console.log("FORGOT-PASSWORD HIT:", emailNorm, new Date().toISOString());

    if (!emailNorm) {
      return res.status(400).json({ status: "error", message: "Email required" });
    }

    // sempre ok (anti-enumerazione)
    const genericOk = () =>
      res.json({
        status: "ok",
        message: "If the email exists, you will receive a link to reset your password.",
      });

    const user = await User.findOne({ email: emailNorm });
    if (!user) return genericOk();

    console.log("FORGOT-PASSWORD USER FOUND:", String(user._id));

    const token = makeRandomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = addMinutes(new Date(), 30);

    await User.updateOne(
      { _id: user._id },
      { $set: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt } }
    );

    const base = process.env.FRONTEND_BASE_URL || "http://localhost:5173";
    const link = `${base}/auth/reset-password?token=${encodeURIComponent(token)}`;
    console.log("🔗 RESET PASSWORD LINK (DEV):", link);
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    const mailDisabled = String(process.env.MAIL_DISABLE || "").toLowerCase() === "true";

    if (!isProd && mailDisabled) {
      return res.json({
        status: "ok",
        message: "If the email is registered, you will receive a reset link.",
        debugResetLink: link,
      });
    }

    try {
      await sendMail({
        to: user.email,
        subject: "NestX — Reset password",
        html: `...`,
      });
    } catch (e) {
      console.error("SMTP SEND ERROR:", e);
      return res.status(500).json({ status: "error", message: "Email send failed." });
    }
    return genericOk();
  } catch (err) {
    console.error("Errore forgot-password:", err);
    return res.status(500).json({ status: "error", message: "Internal error forgot-password" });
  }
});

// --------------------------------------------------
// PASSWORD RESET: POST /api/auth/reset-password
// body: { token, newPassword }
// --------------------------------------------------
router.post("/reset-password", async (req, res) => {
  try {
    const body = req.body || {};
    const { token, newPassword } = body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ status: "error", message: "Token required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ status: "error", message: "Password is too short (minimum 8 characters)." });
    }

    const tokenHash = sha256(token);
    const now = new Date();

    const user = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: now },
    });

    if (!user) {
      return res.status(400).json({ status: "error", message: "This reset link has expired. Please request a new one." });
    }

    const bcrypt = require("bcrypt");
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash,
          passwordResetTokenHash: null,
          passwordResetExpiresAt: null,
        },
        $inc: { tokenVersion: 1 }, // revoke globale
      }
    );

    return res.json({ status: "ok", message: "Password updated successfully" });
  } catch (err) {
    console.error("Errore reset-password:", err);
    return res.status(500).json({ status: "error", message: "Internal error during reset-password" });
  }
});

// --------------------------------------------------
// EMAIL VERIFY: POST /api/auth/verify-email/resend
// body: { email }
// Public route for non-verified users blocked at login
// Anti-enumeration: same generic response in all normal cases
// --------------------------------------------------
router.post("/verify-email/resend", async (req, res) => {
  try {
    const emailNorm = String(req.body?.email || "").trim().toLowerCase();

    if (!emailNorm) {
      return res.status(400).json({
        status: "error",
        message: "Email required",
      });
    }

    const genericOk = () =>
      res.json({
        status: "ok",
        message: "If the account exists and is not yet verified, you will receive a verification email.",
      });

    const user = await User.findOne({ email: emailNorm });
    if (!user) return genericOk();

    if (user.emailVerifiedAt) return genericOk();

    if (user.isDeleted === true) return genericOk();
    if (user.isBanned === true) return genericOk();

    const token = makeRandomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = addMinutes(new Date(), 60);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          emailVerifyTokenHash: tokenHash,
          emailVerifyExpiresAt: expiresAt,
        },
      }
    );

    const base = process.env.FRONTEND_BASE_URL || "http://localhost:5173";
    const link = `${base}/auth/verify-email?token=${encodeURIComponent(token)}`;
    console.log("🔗 VERIFY EMAIL RESEND LINK:", link);

    await sendMail({
      to: user.email,
      subject: "NestX — Verify your email",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <p>Please verify your email to unlock NestX features.</p>
          <p><a href="${link}">Verify email</a></p>
          <p>This link expires in 60 minutes.</p>
          <p>If you did not request this email, you can ignore it.</p>
        </div>
      `,
    });

    return genericOk();
  } catch (err) {
    console.error("Errore verify-email/resend:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error verify-email/resend",
    });
  }
});

// --------------------------------------------------
// EMAIL VERIFY: POST /api/auth/verify-email/request
// auth required (resend dal profilo)
// --------------------------------------------------
router.post("/verify-email/request", authMiddleware, async (req, res) => {
  try {
    const user = req.user;

    if (user.emailVerifiedAt) {
      return res.json({ status: "ok", message: "Email already verified." });
    }

    const token = makeRandomToken(32);
    const tokenHash = sha256(token);
    const expiresAt = addMinutes(new Date(), 60);

    await User.updateOne(
      { _id: user._id },
      { $set: { emailVerifyTokenHash: tokenHash, emailVerifyExpiresAt: expiresAt } }
    );

    const base = process.env.FRONTEND_BASE_URL || "http://localhost:5173";
    const link = `${base}/auth/verify-email?token=${encodeURIComponent(token)}`;
    console.log("🔗 VERIFY EMAIL LINK:", link);

    await sendMail({
      to: user.email,
      subject: "NestX — Email Verification",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <p>Confirm your email.</p>
          <p><a href="${link}">Verify email</a></p>
          <p>The link expires in 60 minutes.</p>
        </div>
      `,
    });

    if (process.env.MAIL_DISABLE === "true") {
      return res.json({ status: "ok", dev: true, verifyLink: link });
    }

    return res.json({ status: "ok", message: "Email sent (if SMTP is configured)" });
  } catch (err) {
    console.error("Errore verify-email/request:", err);
    return res.status(500).json({ status: "error", message: "Internal error verify-email/request" });
  }
});

// --------------------------------------------------
// EMAIL VERIFY: POST /api/auth/verify-email/confirm
// body: { token }
// --------------------------------------------------
router.post("/verify-email/confirm", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ status: "error", message: "Token required" });
    }

    const tokenHash = sha256(token);
    const now = new Date();

    const user = await User.findOne({
      emailVerifyTokenHash: tokenHash,
      emailVerifyExpiresAt: { $gt: now },
    });

    if (!user) {
      return res.status(400).json({ status: "error", message: "This verification link has expired. Please request a new one." });
    }

    await User.updateOne(
      { _id: user._id },
      { $set: { emailVerifiedAt: new Date(), emailVerifyTokenHash: null, emailVerifyExpiresAt: null } }
    );

    return res.json({ status: "ok", message: "Email successfully verified." });
  } catch (err) {
    console.error("Errore verify-email/confirm:", err);
    return res.status(500).json({ status: "error", message: "Internal error verify-email/confirm" });
  }
});

router.get("/mail-status", (req, res) => {
  return res.json({
    status: "ok",
    mailDisabled: process.env.MAIL_DISABLE === "true",
    smtpConfigured: isSmtpConfigured(),
    nodeEnv: process.env.NODE_ENV || "dev",
  });
});

module.exports = router;
