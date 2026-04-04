// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/user");

const JWT_SECRET = process.env.JWT_SECRET || process.env.JVT_SECRET || 'nestx_dev_secret';

async function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ status: "error", message: "Token mancante" });
  }

  const parts = authHeader.split(" ");
  const token = parts.length === 2 ? parts[1] : null;
  if (!token) {
    return res.status(401).json({ status: "error", message: "Token mancante" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const userId = decoded.userId || decoded.id || decoded._id;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Token non valido (manca userId)" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ status: "error", message: "Utente non trovato" });
    }

    // ✅ logout globale: tokenVersion mismatch => revocato
    // compat: se token vecchio senza tokenVersion, trattalo come 0
    const tokenV = typeof decoded.tokenVersion === "number" ? decoded.tokenVersion : 0;
    const userV = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;

    if (tokenV !== userV) {
      return res.status(401).json({ status: "error", message: "Sessione revocata (logout globale)" });
    }

    req.user = user; // sempre user DB completo

    const path = req.originalUrl || req.url || "";
    const method = (req.method || "GET").toUpperCase();

    // --------------------------------------------------
    // HARD DELETED: account self-deleted (purge pending)
    // Allowlist minima: logout-all (optional) + change-password (optional)
    // --------------------------------------------------
    if (user.isDeleted === true) {
      const isDeletedAllowlisted =
        (method === "POST" && path.startsWith("/api/auth/logout-all")) ||
        (method === "POST" && path.startsWith("/api/auth/change-password"));

      if (!isDeletedAllowlisted) {
        return res.status(403).json({
          status: "error",
          code: "ACCOUNT_DELETED",
          message: "Account deleted.",
          deletedAt: user.deletedAt || null,
        });
      }
    }

    // --------------------------------------------------
    // HARD SUSPEND: read-only lock fino a suspendedUntil
    // Allowlist minima: me/profile read + logout/change-password
    // --------------------------------------------------
    if (user.isSuspended === true) {
      const until = user.suspendedUntil ? new Date(user.suspendedUntil).getTime() : 0;
      const now = Date.now();

      // se manca until o è già scaduto, non bloccare (evita soft-lock)
      const stillActive = !!until && now < until;

      if (stillActive) {
        const path = req.originalUrl || req.url || "";
        const method = (req.method || "GET").toUpperCase();

        const isSuspendAllowlisted =
          // serve per far caricare la UI e mostrare banner
          (method === "GET" && path.startsWith("/api/auth/me")) ||
          (method === "GET" && path.startsWith("/api/profile/me")) ||
          (method === "GET" && path.startsWith("/api/profile/status/me")) ||

          // session / security
          (method === "POST" && path.startsWith("/api/auth/logout-all")) ||
          (method === "POST" && path.startsWith("/api/auth/change-password"));

        if (!isSuspendAllowlisted) {
          return res.status(403).json({
            status: "error",
            code: "ACCOUNT_SUSPENDED",
            message: "Account suspended.",
            suspendedUntil: user.suspendedUntil || null,
            suspendReason: user.suspendReason || null,
          });
        }
      }
    }

    // --------------------------------------------------
    // HARD BAN: blocco totale piattaforma (manuale admin)
    // Allowlist minima: solo logout/change-password (opzionale)
    // --------------------------------------------------
    if (user.isBanned === true) {

      const isBanAllowlisted =
        (method === "POST" && path.startsWith("/api/auth/logout-all")) ||
        (method === "POST" && path.startsWith("/api/auth/change-password"));

      if (!isBanAllowlisted) {
        return res.status(403).json({
          status: "error",
          code: "ACCOUNT_BANNED",
          message: "Account bloccato dall’amministrazione."
        });
      }
    }

    // --------------------------------------------------
    // HARD AGE GATE: se manca adultConsentAt => blocco totale piattaforma
    // Allowlist minima: solo endpoint per registrare consenso + logout/change-password
    // --------------------------------------------------

    // allowlist (autenticato ma senza consenso)
    const isAllowlisted =
      // identity: serve per far caricare la UI e mostrare banner/modali
      (method === "GET" && path.startsWith("/api/auth/me")) ||
      (method === "GET" && path.startsWith("/api/profile/me")) ||
      (method === "GET" && path.startsWith("/api/profile/status/me")) ||

      // consent flow
      (method === "POST" && path.startsWith("/api/auth/adult-consent")) ||

      // session / security
      (method === "POST" && path.startsWith("/api/auth/logout-all")) ||
      (method === "POST" && path.startsWith("/api/auth/change-password"));

    // ✅ Admin bypass: l'admin deve poter moderare anche senza adultConsentAt
    const isAdmin = user.accountType === "admin";

    if (!isAdmin && !user.adultConsentAt && !isAllowlisted) {
      return res.status(403).json({
        status: "error",
        code: "ADULT_CONSENT_REQUIRED",
        message: "Devi confermare di avere almeno 18 anni per accedere."
      });
    }

        // --------------------------------------------------
    // HARD EMAIL VERIFY GATE: se manca emailVerifiedAt => read-only
    // Allowlist minima: /me, profile update, resend verify email, logout/change-password
    // --------------------------------------------------
    // HARD EMAIL VERIFY GATE: if email is not verified => limited access (read-only + onboarding)
// Allowlist: me/profile read, profile update, media upload, verify email request, logout/change-password,
// plus "safe GETs" needed by /app/profile to avoid 403 spam.
const isEmailAllowlisted =
  // identity
  (method === "GET" && path.startsWith("/api/auth/me")) ||
  (method === "GET" && path.startsWith("/api/profile/me")) ||
  (method === "GET" && path.startsWith("/api/profile/status/me")) ||

  // onboarding edits (Phase 1)
  (method === "PUT" && path.startsWith("/api/profile/update")) ||
  (method === "POST" && path.startsWith("/api/media/upload")) ||

  // legacy (still allow if present)
  (method === "POST" && path.startsWith("/api/profile/avatar")) ||
  (method === "POST" && path.startsWith("/api/profile/cover")) ||

  // profile page safe reads (avoid console spam)
  (method === "GET" && path.startsWith("/api/posts/me")) ||
  (method === "GET" && path.startsWith("/api/profile/event-banner/")) ||
  (method === "GET" && path.startsWith("/api/profile/old-live/")) ||

  // email verify / session
  (method === "POST" && path.startsWith("/api/auth/verify-email/request")) ||
  (method === "POST" && path.startsWith("/api/auth/logout-all")) ||
  (method === "POST" && path.startsWith("/api/auth/change-password"));

    if (!isAdmin && !user.emailVerifiedAt && !isEmailAllowlisted) {
      return res.status(403).json({
        status: "error",
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Email verification required."
      });
    }

    next();

  } catch (err) {
    console.error("Errore auth middleware:", err);
    return res.status(401).json({ status: "error", message: "Token non valido o scaduto" });
  }
}

module.exports = authMiddleware;
