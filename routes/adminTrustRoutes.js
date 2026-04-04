const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const User = require("../models/user");
const AccountTrustRecord = require("../models/AccountTrustRecord");
const ProhibitedSearchLog = require("../models/ProhibitedSearchLog");

/**
 * GET /api/admin/trust/user/:userId
 * Ritorna:
 * - snapshot user (minimo)
 * - trust record (tier, contatori, lastEvents)
 * - ultimi log ricerche proibite (hash + timestamp) (NO query in chiaro)
 */
router.get("/trust/user/:userId", auth, adminGuard, async (req, res) => {
  try {
    const { userId } = req.params;

    const [user, trust, prohibitedSearches] = await Promise.all([
      User.findById(userId)
        .select("displayName accountType isVip isCreator verifiedUser verificationStatus verificationTotemStatus createdAt")
        .lean(),

      AccountTrustRecord.findOne({ userId }).lean(),

      ProhibitedSearchLog.find({ userId })
        .sort({ createdAt: -1 })
        .limit(20)
        .select("qHash qLen matchedPatternSnapshot createdAt")
        .lean(),
    ]);

    if (!user) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    return res.json({
      status: "ok",
      user,
      trust: trust || {
        userId,
        tier: "OK",
        confirmedTotal: 0,
        confirmedGrave: 0,
        confirmedGravissimo: 0,
        lastConfirmedAt: null,
        lastConfirmedSeverity: null,
        lastConfirmedCategory: null,
        lastEvents: [],
      },
      prohibitedSearches,
    });
  } catch (err) {
    console.error("Admin trust read error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * GET /api/admin/trust/queue
 * Query:
 *  - tier=OK|ATTENZIONE|CRITICO|BLOCCO|all (default: CRITICO,BLOCCO)
 *  - limit=1..200 (default 50)
 *  - q=search displayName (optional)
 *
 * Ritorna lista utenti + trust snapshot ordinati per gravità e freschezza.
 */
router.get("/trust/queue", auth, adminGuard, async (req, res) => {
  try {
    const rawTier = String(req.query.tier || "").trim().toUpperCase();
    const q = String(req.query.q || "").trim();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 200));

    // default: solo CRITICO+BLOCCO
    let tiers;
    if (!rawTier || rawTier === "DEFAULT") tiers = ["CRITICO", "BLOCCO"];
    else if (rawTier === "ALL") tiers = ["OK", "ATTENZIONE", "CRITICO", "BLOCCO"];
    else if (["OK", "ATTENZIONE", "CRITICO", "BLOCCO"].includes(rawTier)) tiers = [rawTier];
    else tiers = ["CRITICO", "BLOCCO"];

    // prendo trust record
    const trustRows = await AccountTrustRecord.find({ tier: { $in: tiers } })
      .sort({ tier: -1, lastConfirmedAt: -1, updatedAt: -1 })
      .limit(limit)
      .lean();

    const userIds = trustRows.map((t) => t.userId);

    // fetch user snapshot (no admin)
    let userQuery = { _id: { $in: userIds }, accountType: { $ne: "admin" } };

    // filtro q su displayName (se presente)
    if (q) userQuery.displayName = { $regex: q, $options: "i" };

    const users = await User.find(userQuery)
      .select("displayName accountType isVip isCreator verifiedUser verificationStatus verificationTotemStatus createdAt")
      .lean();

    // mappa userId -> user
    const uMap = new Map(users.map((u) => [String(u._id), u]));

    // merge preservando ordine trustRows
    const items = trustRows
      .map((t) => {
        const u = uMap.get(String(t.userId));
        if (!u) return null;
        return {
          user: u,
          trust: {
            tier: t.tier,
            confirmedTotal: t.confirmedTotal,
            confirmedGrave: t.confirmedGrave,
            confirmedGravissimo: t.confirmedGravissimo,
            lastConfirmedAt: t.lastConfirmedAt,
            lastConfirmedSeverity: t.lastConfirmedSeverity,
            lastConfirmedCategory: t.lastConfirmedCategory,
            // se vuoi: ultimi 5 eventi per preview
            lastEvents: Array.isArray(t.lastEvents) ? t.lastEvents.slice(-5) : [],
          },
        };
      })
      .filter(Boolean);

    return res.json({ status: "ok", count: items.length, items });
  } catch (err) {
    console.error("Admin trust queue error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
