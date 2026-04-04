// routes/liveSearchRoutes.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const auth = require("../middleware/authMiddleware");

const User = require("../models/user");
const Event = require("../models/event");
const Follow = require("../models/Follow");
const { getBlockedUserIds } = require("../utils/blockUtils");

/**
 * Helpers
 */
function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(Math.max(Math.floor(x), min), max);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// blocchi + privati non seguiti
async function buildExcludedUserIds(meId) {
  // blocchi (entrambi i lati) usando la collection Block
  const blockedIds = await getBlockedUserIds(meId); // io->loro + loro->me
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
    (id) => new mongoose.Types.ObjectId(String(id))
  );

  const privateNotAllowedDocs = await User.find({
    isPrivate: true,
    _id: { $nin: allowedPrivateObjIds },
  })
    .select("_id")
    .lean();

  const privateNotAllowed = privateNotAllowedDocs.map((u) => String(u._id));

  const excluded = new Set([...blockedSet, ...privateNotAllowed]);
  excluded.delete(String(meId)); // io posso sempre vedermi
  return Array.from(excluded);
}

async function getAcceptedFollowingObjIds(meId) {
  const follows = await Follow.find({ followerId: meId, status: "accepted" })
    .select("followingId")
    .lean();

  return follows
    .map((f) => f.followingId)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(id));
}

/**
 * GET /api/live/search
 *
 * Live search = SOLO Eventi
 *
 * query:
 *  q (optional)
 *  status = live | scheduled | all  (default all)
 *  profileType = male|female|couple|gay|trans (optional)
 *  country (optional)  // nation name (DB legacy field = area)
 *  language (optional, VIP only)
 *  page, limit
 */
router.get("/search", auth, async (req, res) => {
  try {
    const me = req.user;
    const contentScope = req.query.contentScope ? String(req.query.contentScope).trim().toUpperCase() : null;

    // VIP = status boolean (come deciso)
    const isVip = me?.isVip === true;
    const meId = me?._id || me?.id;
    if (!meId) return res.status(401).json({ error: "Unauthorized (missing user id)" });

    const meObjId = new mongoose.Types.ObjectId(String(meId));

    const q = String(req.query.q ?? "").trim();
    const status = String(req.query.status ?? "all").toLowerCase().trim();

    const profileType = req.query.profileType
      ? String(req.query.profileType).trim().toLowerCase()
      : null;

    // country = creator area (profile field)
    const country = req.query.country
      ? String(req.query.country).trim().toLowerCase()
      : (req.query.area ? String(req.query.area).trim().toLowerCase() : null);

    const language = req.query.language
      ? String(req.query.language).trim().toLowerCase()
      : null;

    const page = clampInt(req.query.page, 1, 1000000, 1);
    const limit = clampInt(req.query.limit, 1, 50, 20);
    const skip = (page - 1) * limit;

    const allowedProfileTypes = ["male", "female", "couple", "gay", "trans"];
    const safeProfileType = allowedProfileTypes.includes(profileType) ? profileType : null;

    const excludedUserIds = await buildExcludedUserIds(meObjId);
    const excludedObjIds = excludedUserIds.map((id) => new mongoose.Types.ObjectId(id));

    const adminUsers = await User.find({ accountType: "admin" }).select("_id").lean();
    const adminObjIds = adminUsers.map((u) => new mongoose.Types.ObjectId(String(u._id)));

    const finalExcludedObjIds = Array.from(
      new Set([...excludedObjIds.map(String), ...adminObjIds.map(String)])
    ).map((id) => new mongoose.Types.ObjectId(id));

    const acceptedFollowingObjIds = await getAcceptedFollowingObjIds(meObjId);

    // -------------------------
    // Creator-based filters
    // profileType / country(area) / language are USER fields, not event fields
    // q must also match creator displayName/username
    // -------------------------
    const hasCreatorBaseFilters = Boolean(safeProfileType || country || language);

    let creatorBaseObjIds = null;

    if (hasCreatorBaseFilters) {
      const creatorBaseFilter = {
        _id: { $nin: finalExcludedObjIds },
      };

      if (safeProfileType) creatorBaseFilter.profileType = safeProfileType;

      if (country) {
        creatorBaseFilter.area = new RegExp(`^${escapeRegex(country)}$`, "i");
      }

      // ✅ VIP ONLY
      if (isVip && language) {
        creatorBaseFilter.language = new RegExp(`^${escapeRegex(language)}$`, "i");
      }

      const creatorBaseDocs = await User.find(creatorBaseFilter).select("_id").lean();
      creatorBaseObjIds = creatorBaseDocs.map((u) => new mongoose.Types.ObjectId(String(u._id)));

      if (!creatorBaseObjIds.length) {
        return res.json({ page, limit, total: 0, items: [] });
      }
    }

    let creatorQObjIds = [];

    if (q) {
      const rxCreator = new RegExp(escapeRegex(q), "i");

      const creatorQFilter = {
        _id: hasCreatorBaseFilters
          ? { $in: creatorBaseObjIds }
          : { $nin: finalExcludedObjIds },
        $or: [
          { displayName: rxCreator },
          { username: rxCreator },
        ],
      };

      const creatorQDocs = await User.find(creatorQFilter).select("_id").lean();
      creatorQObjIds = creatorQDocs.map((u) => new mongoose.Types.ObjectId(String(u._id)));
    }

    // -------------------------
    // Query base eventi
    // -------------------------
    const query = {
      creatorId: hasCreatorBaseFilters
        ? { $in: creatorBaseObjIds, $nin: finalExcludedObjIds }
        : { $nin: finalExcludedObjIds },
    };

    if (contentScope === "HOT" || contentScope === "NO_HOT") {
      query.contentScope = contentScope;
    }

    // status: SOLO live/scheduled
    if (status === "live") query.status = "live";
    else if (status === "scheduled") query.status = "scheduled";
    else query.status = { $in: ["live", "scheduled"] };

    // q = title / description / category / creator name
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      query.$or = [
        { title: rx },
        { description: rx },
        { category: rx },
        ...(creatorQObjIds.length ? [{ creatorId: { $in: creatorQObjIds } }] : []),
      ];
    }

    // -------------------------
    // VISIBILITY RULES (CRITICO)
    // -------------------------
    // - unlisted MAI in search
    // - public sempre
    // - followers solo se follow accepted
    // - i miei eventi: ok (public/followers), ma mai unlisted
    const andParts = [];

    andParts.push(
      { visibility: { $ne: "unlisted" } },
      {
        $or: [
          { visibility: "public" },
          { visibility: "followers", creatorId: { $in: acceptedFollowingObjIds } },
          { creatorId: meObjId, visibility: { $in: ["public", "followers"] } },
        ],
      }
    );

    query.$and = andParts;

    // -------------------------
    // Sorting: live prima, poi scheduled (più vicini prima)
    // -------------------------
    const pipeline = [
      { $match: query },
      {
        $addFields: {
          _sortBucket: { $cond: [{ $eq: ["$status", "live"] }, 0, 1] },
          _sortLiveTs: { $ifNull: ["$live.startedAt", "$startedAt"] },
          _sortSchedTs: { $ifNull: ["$startTime", "$plannedStartTime"] },
        },
      },
      {
        $sort: {
          _sortBucket: 1,
          _sortLiveTs: -1,
          _sortSchedTs: 1,
          updatedAt: -1,
        },
      },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          _sortBucket: 0,
          _sortLiveTs: 0,
          _sortSchedTs: 0,
        },
      },
    ];

    const [items, total] = await Promise.all([
      Event.aggregate(pipeline),
      Event.countDocuments(query),
    ]);

    // attach creator minimal (populate manuale)
    const creatorIds = Array.from(new Set(items.map((e) => String(e.creatorId)).filter(Boolean)));
    const creators = await User.find({ _id: { $in: creatorIds } })
      .select("displayName username avatar isPrivate")
      .lean();

    const byId = new Map(creators.map((u) => [String(u._id), u]));

    const result = items.map((ev) => ({
      ...ev,
      creator: byId.get(String(ev.creatorId)) || null,
    }));

    return res.json({ page, limit, total, items: result });
  } catch (err) {
    console.error("LIVE SEARCH ERROR:", err);
    return res.status(500).json({ error: "Live search failed" });
  }
});

module.exports = router;
