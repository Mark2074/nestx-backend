// routes/searchRoutes.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const User = require("../models/user");
const Post = require("../models/Post");
const Event = require("../models/event");
const Follow = require("../models/Follow");

const auth = require("../middleware/authMiddleware");
const { getBlockedUserIds } = require("../utils/blockUtils");
const crypto = require("crypto");
const SensitiveDictionaryEntry = require("../models/SensitiveDictionaryEntry");
const ProhibitedSearchLog = require("../models/ProhibitedSearchLog");
const AccountTrustRecord = require("../models/AccountTrustRecord");

// ----------------------------------------
// Helpers
// ----------------------------------------
function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(Math.max(Math.floor(x), min), max);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normQuery(q) {
  return String(q || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

// Privati non seguiti (accepted) + bloccati (both directions)
async function buildExcludedUserIds(meId, options = {}) {
  const isAdmin = options.isAdmin === true;
  // blocchi (entrambi i lati)
  const blockedIds = await getBlockedUserIds(meId); // deve includere io->loro + loro->me
  const blockedSet = new Set(blockedIds.map((id) => String(id)));

  // follow accepted: io -> loro
  const acceptedFollows = await Follow.find({ followerId: meId, status: "accepted" })
    .select("followingId")
    .lean();

  const allowedPrivateSet = new Set([
    String(meId),
    ...acceptedFollows.map((f) => String(f.followingId)),
  ]);

  // privati che NON posso vedere (scalabile: prende solo quelli non allowed)
  const allowedPrivateObjIds = Array.from(allowedPrivateSet).map(
    (id) => new mongoose.Types.ObjectId(id)
  );

  let privateNotAllowed = [];
  let bannedIds = [];

  if (!isAdmin) {
    const [privateNotAllowedDocs, bannedDocs] = await Promise.all([
      User.find({
        isPrivate: true,
        _id: { $nin: allowedPrivateObjIds },
      })
        .select("_id")
        .lean(),
      User.find({
        isBanned: true,
      })
        .select("_id")
        .lean(),
    ]);

    privateNotAllowed = privateNotAllowedDocs.map((u) => String(u._id));
    bannedIds = bannedDocs.map((u) => String(u._id));
  }

  const excluded = new Set([...blockedSet, ...privateNotAllowed, ...bannedIds]);
  excluded.delete(String(meId)); // io posso sempre vedermi
  return Array.from(excluded);
}

async function getAcceptedFollowingObjIds(meId) {
  const follows = await Follow.find({ followerId: meId, status: "accepted" })
    .select("followingId")
    .lean();
  return follows.map((f) => f.followingId);
}

async function checkProhibitedSearch(q) {
  if (!q || q.length < 2) return null;

  const qNorm = String(q).toLowerCase();

  const entries = await SensitiveDictionaryEntry.find({ isActive: true }).lean();
  for (const e of entries) {
    try {
      if (e.matchType === "regex") {
        const rx = new RegExp(e.pattern, "i");
        if (rx.test(qNorm)) return e;
      } else {
        if (qNorm.includes(e.pattern)) return e;
      }
    } catch (err) {
      // regex invalida → ignorata
      continue;
    }
  }
  return null;
}

// --------------------------------------------------
// GET /api/search
// --------------------------------------------------
router.get("/search", auth, async (req, res) => {
  try {
    const me = req.user;
    const isAdmin = req.user?.accountType === "admin";
    const isVip = req.user?.isVip === true;
    const canUseVipFilters = isVip || isAdmin;

    const q = String(req.query.q ?? "").trim();

    // --------------------------------------------------
    // HARD BLOCK: ricerche proibite (minori / borderline)
    // --------------------------------------------------
    const matchedEntry = await checkProhibitedSearch(q);

    if (matchedEntry) {
      // hash query (NO chiaro)
      const qHash = crypto
        .createHash("sha256")
        .update(q.toLowerCase())
        .digest("hex");

      await ProhibitedSearchLog.create({
        userId: req.user._id,
        qHash,
        qLen: q.length,
        matchedPatternSnapshot: {
          pattern: matchedEntry.pattern,
          matchType: matchedEntry.matchType,
          severity: matchedEntry.severity,
          category: matchedEntry.category,
        },
      });

      // --------------------------------------------------
      // TRUST: strike cumulativo su ricerche proibite (indipendente dal pattern)
      // --------------------------------------------------
      const now = new Date();

      // aggiorna record trust: contatore + lastEvents (max 20)
      const trust = await AccountTrustRecord.findOneAndUpdate(
        { userId: req.user._id },
        {
          $inc: { prohibitedSearchTotal: 1 },
          $set: {
            lastProhibitedSearchAt: now,
            updatedByAdminId: null, // non è azione admin
          },
          $push: {
            lastEvents: {
              $each: [
                {
                  kind: "prohibited_search",
                  severity: matchedEntry.severity || "grave",
                  category: matchedEntry.category || null,
                  at: now,
                  meta: {
                    qHash,
                    pattern: matchedEntry.pattern,
                    matchType: matchedEntry.matchType,
                  },
                },
              ],
              $slice: -20,
            },
          },
        },
        { new: true, upsert: true }
      );

      // ricalcolo tier basato su RECENZA (cumulativo, non per parola)
      const events = Array.isArray(trust.lastEvents) ? trust.lastEvents : [];

      // conteggi finestra
      const ms7d = 7 * 24 * 60 * 60 * 1000;
      const ms30d = 30 * 24 * 60 * 60 * 1000;

      let count7d = 0;
      let count30d = 0;

      for (const ev of events) {
        if (!ev || ev.kind !== "prohibited_search" || !ev.at) continue;
        const t = new Date(ev.at).getTime();
        if (now.getTime() - t <= ms30d) count30d++;
        if (now.getTime() - t <= ms7d) count7d++;
      }

      // soglie semplici (coerenti col concept: warning, poi critico)
      let newTier = trust.tier || "OK";

      // BLOCCO resta BLOCCO se già assegnato da gravissimo report ecc.
      if (newTier !== "BLOCCO") {
        if (count30d >= 3) newTier = "CRITICO";
        else if (count7d >= 2) newTier = "ATTENZIONE";
        else newTier = "OK";
      }

      const tierScoreMap = { OK: 0, ATTENZIONE: 1, CRITICO: 2, BLOCCO: 3 };
      const newTierScore = tierScoreMap[newTier];

      // aggiorna tier solo se peggiora o cambia score coerentemente
      if (newTier !== trust.tier || newTierScore !== trust.tierScore) {
        await AccountTrustRecord.updateOne(
          { _id: trust._id },
          { $set: { tier: newTier, tierScore: newTierScore } }
        );
      }

      return res.status(403).json({
        status: "error",
        code: "PROHIBITED_SEARCH",
        message:
          "NESTX has a zero-tolerance policy against pedophilia, child exploitation, and borderline sexual content. Research is not permitted.\n\nSuch behavior may result in account restrictions and, where required by law, reporting to the appropriate authorities.",
      });
    }

    const type = String(req.query.type ?? "posts").trim().toLowerCase();
    const allowedTypes = new Set(["posts", "users", "events"]);
    const safeType = allowedTypes.has(type) ? type : "posts";

    const page = clampInt(req.query.page, 1, 1000000, 1);
    const limit = clampInt(req.query.limit, 1, 50, 10);
    const skip = (page - 1) * limit;

    // NOTE: memo = country (nome Stato) — supporto fallback area per compatibilità (se frontend vecchio manda area)
    const profileType = req.query.profileType ? String(req.query.profileType).trim() : null;

    // country = NAZIONE (nome completo). DB legacy usa "area".
    const country = req.query.country
      ? String(req.query.country).trim()
      : (req.query.area ? String(req.query.area).trim() : null);

    const language = req.query.language ? String(req.query.language).trim() : null;

    const rx = q ? new RegExp(escapeRegex(q), "i") : null;

    const blockedIdsRaw = await getBlockedUserIds(me._id);
    const blockedIds = Array.isArray(blockedIdsRaw) ? blockedIdsRaw.map((id) => String(id)) : [];

    const excludedUserIds = await buildExcludedUserIds(me._id, { isAdmin });
    const acceptedFollowingObjIds = await getAcceptedFollowingObjIds(me._id);

    const adminUsers = await User.find({ accountType: "admin" }).select("_id").lean();
    const adminIds = adminUsers.map((u) => String(u._id));

    let bannedIds = [];
    if (!isAdmin) {
      const bannedUsers = await User.find({ isBanned: true }).select("_id").lean();
      bannedIds = bannedUsers.map((u) => String(u._id));
    }

    // EXCLUSIONS:
    // - USERS: blocked + admin + banned
    // - POSTS/EVENTS: blocked + privateNotAllowed + admin + banned
    const finalExcludedUserIdsUsers = Array.from(
      new Set([...blockedIds, ...adminIds, ...bannedIds])
    );

    const finalExcludedUserIdsPostsEvents = Array.from(
      new Set([...excludedUserIds.map(String), ...adminIds, ...bannedIds])
    );

    const finalExcludedObjIdsUsers = finalExcludedUserIdsUsers
      .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));

    // ObjectId pronti per query su Post/Event (authorId/creatorId)
    const finalExcludedObjIds = finalExcludedUserIdsPostsEvents
      .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));

    // ------------------------
    // 1) USERS
    // ------------------------
    let users = [];
    if (safeType === "users") {
      const userQuery = {
        _id: { $nin: finalExcludedObjIdsUsers },
      };

      if (rx) {
        userQuery.$or = [{ displayName: rx }, { bio: rx }];
      }

      // VIP only: profileType/country/language
      if (canUseVipFilters) {
        if (profileType) userQuery.profileType = profileType;

        if (country) {
          userQuery.$and = userQuery.$and || [];
          userQuery.$and.push({
            $or: [
              { "location.country": country },
              { country: country },
              { area: country }, // legacy
            ],
          });
        }

        if (language) userQuery.language = language;
      }

      users = await User.find(userQuery)
        .select("displayName avatar bio profileType isPrivate")
        .skip(skip)
        .limit(limit)
        .lean();
    }

    // ------------------------
    // 2) POSTS
    // ------------------------
    let posts = [];
    if (safeType === "posts") {
      const postQuery = {
        authorId: { $nin: finalExcludedObjIds },
      };

      postQuery["moderation.isDeleted"] = { $ne: true };
      postQuery["moderation.status"] = "visible";

      if (rx) {
        postQuery.$or = [{ text: rx }, { tags: rx }];
      }

      // visibilità post in search:
      // - public sempre
      // - followers SOLO se follow accepted
      // - i miei post sempre
      postQuery.$and = [
        {
          $or: [
            { visibility: "public" },
            { visibility: "followers", authorId: { $in: acceptedFollowingObjIds } },
            { authorId: me._id },
          ],
        },
      ];

      // VIP only: filtri su AUTORE (non sul post)
      if (canUseVipFilters && (profileType || country || language)) {        const authorQ = { _id: { $nin: finalExcludedObjIds } };
        if (profileType) authorQ.profileType = profileType;
        if (language) authorQ.language = language;

        if (country) {
          authorQ.$and = authorQ.$and || [];
          authorQ.$and.push({ $or: [{ "location.country": country }, { area: country }] });
        }

        const authorDocs = await User.find(authorQ).select("_id").lean();
        const authorIds = authorDocs.map((u) => u._id);

        // se filtro stringe a zero, posts resta vuoto
        postQuery.authorId = { $in: authorIds, $nin: finalExcludedObjIds };
      }

      postQuery.isHidden = { $ne: true };
      postQuery["moderation.status"] = { $ne: "hidden" };

      posts = await Post.find(postQuery)
        .select("-area -language") // non esportare
        .populate("authorId", "displayName avatar isPrivate") // no role/accountType
        .skip(skip)
        .limit(limit)
        .lean();
    }

    // ------------------------
    // 3) EVENTS
    // ------------------------
    let events = [];
    if (safeType === "events") {
      const eventQuery = {
        creatorId: { $nin: finalExcludedObjIds },
        status: { $in: ["live", "scheduled"] }, // no finished/cancelled/old
      };

      if (rx) {
        eventQuery.$or = [{ title: rx }, { description: rx }, { category: rx }];
      }

      // unlisted mai
      eventQuery.$and = [
        { visibility: { $ne: "unlisted" } },
        {
          $or: [
            { visibility: "public" },
            { visibility: "followers", creatorId: { $in: acceptedFollowingObjIds } },
            { creatorId: me._id, visibility: { $in: ["public", "followers"] } },
          ],
        },
      ];

      // EVENTS: profileType + country disponibili Base+VIP
      if (profileType) eventQuery.targetProfileType = profileType;

      if (country) {
        eventQuery.$and = eventQuery.$and || [];
        eventQuery.$and.push({
          $or: [
            { "location.country": country },
            { country: country },
            { area: country }, // legacy
          ],
        });
      }

      // EVENTS: language VIP only
      if (canUseVipFilters && language) {
        eventQuery.language = language;
      }

      events = await Event.find(eventQuery)
        .select("-area -language -targetProfileType") // non esportare
        .skip(skip)
        .limit(limit)
        .lean();
    }

    return res.json({
      page,
      limit,
      type: safeType,
      users,
      posts,
      events,
    });
  } catch (err) {
    console.error("SEARCH ERROR:", err);
    return res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
