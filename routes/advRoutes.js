const express = require('express');
const router = express.Router();

const auth = require('../middleware/authMiddleware');
const Adv = require('../models/adv');
const User = require('../models/user');
const Notification = require('../models/notification');
const { getBlockedUserIds, isUserBlockedEitherSide } = require("../utils/blockUtils");
const crypto = require("crypto");
const Event = require("../models/event");
const LiveRoom = require("../models/LiveRoom");
const TokenTransaction = require("../models/tokenTransaction");
const mongoose = require("mongoose");
const { debitUserTokensBuckets } = require("../services/tokenDebitService");

// --- ADV rules ---
const ADV_FREE_PER_DAY = 2;
const ADV_PAID_PRICE_TOKENS = 10; // definitivo
const DEFAULT_CONTEXT = "standard"; // standard | neutral | live_events

function getStartOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function ctxWeight(ctx) {
  if (ctx === "live_events") return 1.3;
  if (ctx === "neutral") return 0.8;
  return 1.0;
}

// Paid: sempre sopra. Context: modula SOLO i free.
function scoreAdv(adv, ctx) {
  const paidBoost = adv.billingType === "paid" ? 100000 : 0;
  const mul = adv.billingType === "paid" ? 1.0 : ctxWeight(ctx);
  return (paidBoost + 10) * mul;
}

// finestre temporali standard (startsAt/endsAt)
function activeWindowQuery(now = new Date()) {
  return {
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  };
}

function isUserDeletedLike(user) {
  return user?.isDeleted === true || !!user?.deletedAt;
}

async function getNonPublicCreatorIds({ isAdminViewer = false } = {}) {
  if (isAdminViewer) return [];

  const docs = await User.find({
    $or: [
      { accountType: "admin" },
      { isBanned: true },
      { isDeleted: true },
      { deletedAt: { $ne: null } },
    ],
  })
    .select("_id")
    .lean();

  return docs.map((u) => String(u._id));
}

async function ensureCreator(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        status: "error",
        message: "Authentication required",
      });
    }

    const userId = req.user._id;

    // ✅ creator approvato = isCreator true (fallback: accountType creator)
    const user = await User.findById(userId).select("isCreator accountType").lean();
    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "User not found",
      });
    }

    const ok =
      user.isCreator === true || String(user.accountType || "").toLowerCase() === "creator";

    if (ok) return next();

    return res.status(403).json({
      status: "error",
      code: "CREATOR_REQUIRED",
      message: "Only creators can create ADV.",
    });
  } catch (err) {
    console.error("ensureCreator error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error checking ADV permissions",
    });
  }
}

/**
 * POST /api/adv
 * Crea una nuova campagna ADV
 * (uso interno / di test: in produzione la useremo dietro pannello admin)
*/
router.post('/campaign', auth, ensureCreator, async (req, res) => {
  try {
    const {
      title,
      text,
      mediaUrl,
      targetUrl,
      placement = 'feed',
      targetType = 'url',
      targetId = null,
      languages = [],
      countries = [],
      confirmPaid = false,
    } = req.body;

    if (!title || !targetUrl) {
      return res.status(400).json({
        status: "error",
        message: "Body ADV missing or incomplete (title/targetUrl)",
      });
    }

    const cleanedTargetUrl = String(targetUrl).trim();

    if (
      !cleanedTargetUrl.startsWith("/") ||
      cleanedTargetUrl.startsWith("//") ||
      /^https?:\/\//i.test(cleanedTargetUrl)
    ) {
      return res.status(400).json({
        status: "error",
        message: "Invalid targetUrl: only internal links are allowed (path starting with /)",
      });
    }

    if (!['feed', 'pre_event', 'profile'].includes(placement)) {
      return res.status(400).json({
        status: 'error',
        message: 'invalid placement',
      });
    }

    if (!["event", "liveRoom", "url"].includes(String(targetType || ""))) {
      return res.status(400).json({
        status: "error",
        message: "invalid targetType",
      });
    }

    // ADV scheduling is server-driven only.
    // startsAt/endsAt must NEVER come from FE form payload.
    if (req.body?.startsAt != null || req.body?.endsAt != null) {
      return res.status(400).json({
        status: "error",
        code: "ADV_MANUAL_WINDOW_NOT_ALLOWED",
        message: "ADV start/end dates cannot be set manually. Promotion timing is determined automatically by the related event/live and platform rules.",
      });
    }

    let safeMediaUrl = mediaUrl ? String(mediaUrl).trim() : "";
    let advContentScope = "NO_HOT";

    const now = new Date();
    const hardEndsAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    let effectiveEndsAt = hardEndsAt;

    let ev = null;
    let live = null;

    if (targetType === "event" && targetId) {
      ev = await Event.findById(targetId)
        .select("coverImage contentScope status startTime durationMinutes canceledAt endedAt")
        .lean();

      if (!ev) {
        return res.status(404).json({
          status: "error",
          code: "EVENT_NOT_FOUND",
          message: "Event not found for this promoted item.",
        });
      }

      const start = ev.startTime ? new Date(ev.startTime) : null;

      if (start) {
        const diffMs = start.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours > 48) {
          return res.status(400).json({
            status: "error",
            code: "ADV_TOO_EARLY",
            message: "Promoted events can only be created within 48 hours of start time.",
          });
        }

        if (diffMs <= 0) {
          return res.status(400).json({
            status: "error",
            code: "ADV_EVENT_STARTED",
            message: "Cannot promote an event that has already started.",
          });
        }
      }

      const st = String(ev.status || "").toUpperCase();
      const isCanceled = Boolean(ev.canceledAt) || st === "CANCELED" || st === "CANCELLED";
      const isFinished = Boolean(ev.endedAt) || st === "FINISHED" || st === "ENDED";

      if (isCanceled || isFinished) {
        return res.status(409).json({
          status: "error",
          code: "EVENT_NOT_ACTIVE",
          message: "This event is not active anymore.",
        });
      }

      const durMin = Number(ev.durationMinutes || 0);

      if (start && Number.isFinite(durMin) && durMin > 0) {
        const eventEnd = new Date(start.getTime() + durMin * 60 * 1000);

        if (eventEnd.getTime() <= now.getTime()) {
          return res.status(409).json({
            status: "error",
            code: "EVENT_ALREADY_ENDED",
            message: "This event already ended.",
          });
        }
      }

      // endsAt is ALWAYS max 48h from creation.
      // Early removal for ended/cancelled event is handled in serve filters.
      effectiveEndsAt = hardEndsAt;

      if (!safeMediaUrl && ev.coverImage) {
        safeMediaUrl = String(ev.coverImage);
      }

      if (ev.contentScope === "HOT" || ev.contentScope === "NO_HOT") {
        advContentScope = ev.contentScope;
      }
    }

    if (targetType === "liveRoom" && targetId) {
      live = await LiveRoom.findById(targetId)
        .select("coverImage contentScope status scheduledStartAt canceledAt endedAt")
        .lean();

      if (!live) {
        return res.status(404).json({
          status: "error",
          code: "LIVE_NOT_FOUND",
          message: "Live not found for this promoted item.",
        });
      }

      const liveStart = live.scheduledStartAt ? new Date(live.scheduledStartAt) : null;

      if (liveStart) {
        const diffMs = liveStart.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffHours > 48) {
          return res.status(400).json({
            status: "error",
            code: "ADV_TOO_EARLY",
            message: "Promoted lives can only be created within 48 hours of start time.",
          });
        }

        if (diffMs <= 0) {
          return res.status(400).json({
            status: "error",
            code: "ADV_LIVE_STARTED",
            message: "Cannot promote a live that has already started.",
          });
        }
      }

      const lst = String(live.status || "").toUpperCase();
      const isCanceled =
        Boolean(live.canceledAt) || lst === "CANCELED" || lst === "CANCELLED";
      const isFinished =
        Boolean(live.endedAt) || lst === "FINISHED" || lst === "ENDED" || lst === "CLOSED";

      if (isCanceled || isFinished) {
        return res.status(409).json({
          status: "error",
          code: "LIVE_NOT_ACTIVE",
          message: "This live is not active anymore.",
        });
      }

      if (!safeMediaUrl && live.coverImage) {
        safeMediaUrl = String(live.coverImage);
      }

      if (live.contentScope === "HOT" || live.contentScope === "NO_HOT") {
        advContentScope = live.contentScope;
      }
    }

    const creatorId = req.user._id;
    const opId = `adv_${creatorId}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const startOfDay = getStartOfDay();
    const freeAdvUsed = await Adv.countDocuments({
      creatorId,
      billingType: "free",
      createdAt: { $gte: startOfDay },
    });

    let billingType = "free";
    let paidTokens = 0;
    let chargedGroupId = null;

    if (freeAdvUsed >= ADV_FREE_PER_DAY) {
      billingType = "paid";
      paidTokens = ADV_PAID_PRICE_TOKENS;

      const tokensEnabled =
        String(process.env.TOKENS_ENABLED || "").toLowerCase() === "true";
      const economyEnabled =
        String(process.env.ECONOMY_ENABLED || "").toLowerCase() === "true";

      if (!tokensEnabled || !economyEnabled) {
        return res.status(403).json({
          status: "error",
          code: "ADV_PAID_DISABLED",
          message: "Paid ADV campaigns are currently disabled by NestX.",
        });
      }

      const me = await User.findById(creatorId)
        .select("tokenPurchased tokenEarnings tokenRedeemable")
        .lean();

      const p0 = Number(me?.tokenPurchased || 0);
      const e0 = Number(me?.tokenEarnings || 0);
      const r0 = Number(me?.tokenRedeemable || 0);
      const total = p0 + e0 + r0;

      if (total < paidTokens) {
        return res.status(403).json({
          status: "error",
          code: "INSUFFICIENT_TOKENS",
          message: "You've already used today's 2 free ads. To post another, you need 10 tokens.",
        });
      }

      const confirmed = String(confirmPaid).toLowerCase() === "true" || confirmPaid === true;
      if (!confirmed) {
        return res.status(409).json({
          status: "error",
          code: "ADV_PAYMENT_REQUIRED",
          priceTokens: paidTokens,
          message: "You've already used today's 2 free ads. This ad is paid (10 tokens). Do you want to continue?",
        });
      }

      chargedGroupId = `grp_${crypto.randomUUID()}`;
    }

    if (billingType === "paid") {

      console.log("[ADV] paid start", {
        user: String(creatorId),
        tokens: paidTokens,
        placement,
        targetType,
        targetId: targetId ? String(targetId) : null,
      });
      const session = await mongoose.startSession();

      try {
        let createdAdv = null;

        await session.withTransaction(async () => {
          const debit = await debitUserTokensBuckets({
            userId: creatorId,
            amountTokens: paidTokens,
            session,
          });

          if (!debit.ok) {
            const err = new Error("Not enough tokens to publish this ad.");
            err.statusCode = 403;
            throw err;
          }

          await TokenTransaction.create(
            [
              {
                groupId: chargedGroupId,
                opId,
                kind: "adv_purchase",
                direction: "debit",
                amountTokens: paidTokens,
                amountEuro: 0,
                context: "adv",
                fromUserId: creatorId,
                toUserId: null,
                metadata: {
                  placement,
                  targetType,
                  targetId: targetId ? String(targetId) : null,
                  title: String(title || "").trim(),
                  chargedGroupId,
                  spentFromPurchased: debit.usedFromPurchased,
                  spentFromEarnings: debit.usedFromEarnings,
                  spentFromRedeemable: debit.usedFromRedeemable,
                },
              },
            ],
            { session }
          );

          const advDocs = await Adv.create(
            [
              {
                creatorId,
                billingType,
                paidTokens,
                title: String(title).trim(),
                text: text ? String(text).trim() : '',
                targetUrl: cleanedTargetUrl,
                placement,
                targetType,
                targetId,
                startsAt: now,
                endsAt: effectiveEndsAt,
                languages,
                countries,
                isActive: true,
                reviewStatus: "approved",
                reviewedBy: creatorId,
                reviewedAt: now,
                reviewNote: "Phase 1 auto-approved",
                mediaUrl: safeMediaUrl,
                contentScope: advContentScope,
                chargedGroupId,
                opId,
              },
            ],
            { session }
          );

          createdAdv = advDocs[0];
          console.log("[ADV] created", {
            advId: String(createdAdv._id),
            billingType,
            paidTokens,
          });
        });

        return res.status(201).json({
          status: 'success',
          data: createdAdv,
          advQuota: {
            freeAdvUsed,
            freeAdvLimit: ADV_FREE_PER_DAY,
            freeAdvRemaining: Math.max(0, ADV_FREE_PER_DAY - freeAdvUsed),
          },
        });
      } catch (err) {
        console.error("[ADV] error", {
          message: err?.message,
          code: err?.code,
          statusCode: err?.statusCode,
        });

        const statusCode = Number(err?.statusCode || 500);
        const message =
          statusCode === 403
            ? 'Not enough tokens to publish this ad.'
            : 'Internal error while creating the ADV campaign';

        return res.status(statusCode).json({
          status: 'error',
          message,
        });
      } finally {
        session.endSession();
      }
    }

    const adv = await Adv.create({
      creatorId,
      billingType,
      paidTokens,
      title: String(title).trim(),
      text: text ? String(text).trim() : '',
      targetUrl: cleanedTargetUrl,
      placement,
      targetType,
      targetId,
      startsAt: now,
      endsAt: effectiveEndsAt,
      languages,
      countries,
      isActive: true,
      reviewStatus: "approved",
      reviewedBy: creatorId,
      reviewedAt: now,
      reviewNote: "Phase 1 auto-approved",
      mediaUrl: safeMediaUrl,
      contentScope: advContentScope,
      chargedGroupId,
      opId,
    });

    return res.status(201).json({
      status: 'success',
      data: adv,
      advQuota: {
        freeAdvUsed: freeAdvUsed + 1,
        freeAdvLimit: ADV_FREE_PER_DAY,
        freeAdvRemaining: Math.max(0, ADV_FREE_PER_DAY - (freeAdvUsed + 1)),
      },
    });
  } catch (err) {
    console.error('Errore creazione ADV:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Internal error while creating the ADV campaign',
    });
  }
});

// GET /api/adv/profile/active/:userId
router.get('/profile/active/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const now = new Date();
    const isAdminViewer = String(req.user?.accountType || "").toLowerCase() === "admin";

    const targetCreator = await User.findById(userId)
      .select("_id accountType isBanned isDeleted deletedAt")
      .lean();

    if (!targetCreator) {
      return res.status(200).json({ status: 'success', data: null });
    }

    if (
      !isAdminViewer &&
      (
        targetCreator?.accountType === "admin" ||
        targetCreator?.isBanned === true ||
        isUserDeletedLike(targetCreator)
      )
    ) {
      return res.status(200).json({ status: 'success', data: null });
    }

    const meId = String(req.user?._id || req.user?.id || "");
    if (meId && userId) {
      const blocked = await isUserBlockedEitherSide(meId, String(userId));
      if (blocked) {
        return res.status(403).json({
          status: "error",
          code: "PROFILE_BLOCKED",
          message: "Profile not available",
        });
      }
    }

    const adv = await Adv.findOne({
      creatorId: userId,
      placement: 'profile',
      isActive: true,
      reviewStatus: "approved",
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!adv) {
      return res.status(200).json({ status: 'success', data: null });
    }

    // impression “grezza”
    await Adv.updateOne({ _id: adv._id }, { $inc: { impressions: 1 } });

    return res.status(200).json({ status: 'success', data: adv });
  } catch (err) {
    console.error('Errore get profile active adv:', err);
    return res.status(500).json({ status: 'error', message: 'Internal error ADV profile' });
  }
});

/**
 * GET /api/adv/serve?placement=feed
 * Restituisce un piccolo set di ADV adatte all’utente corrente,
 * applicando le regole di ruolo (base / vip / creator).
 */
router.get('/serve', auth, async (req, res) => {
  try {
    const placement = req.query.placement || 'feed';

    if (!req.user) {
      return res.status(401).json({ status: 'error', message: 'Authentication required' });
    }

    const userId = req.user._id;

    const dbUser = await User.findById(userId).select('accountType isVip appSettings.contentContext');
    if (!dbUser) {
      return res.status(401).json({ status: 'error', message: 'User not found' });
    }

    const accountType = dbUser.accountType || 'base';
    const isVip = dbUser.isVip === true;

    const blockedIds = await getBlockedUserIds(String(userId));
    const isAdminViewer = String(dbUser?.accountType || "").toLowerCase() === "admin";
    const hiddenCreatorIds = await getNonPublicCreatorIds({ isAdminViewer });

    // 🔹 content context (standard | neutral | live_events)
    const ctx = dbUser?.appSettings?.contentContext || DEFAULT_CONTEXT;

    const maxAds = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

    const now = new Date();

    const query2 = {
      isActive: true,
      reviewStatus: "approved",
      placement,
      creatorId: { $nin: [...blockedIds, ...hiddenCreatorIds] },
      ...activeWindowQuery(now),
    };

    // 🔹 Neutral mode → NO HOT ads
    if (ctx === "neutral") {
      // neutral = escludi HOT, ma includi anche ADV vecchi senza contentScope
      query2.contentScope = { $ne: "HOT" };
    }

    let pool = await Adv.find(query2).limit(50).lean(); // alzo un po' il pool per compensare i filtri event
    // 1) filtro scadenza hard (non fidarti solo di activeWindowQuery)
    pool = pool.filter((a) => {
      const ends = a?.endsAt ? new Date(a.endsAt) : null;
      return !ends || ends.getTime() > now.getTime(); // se endsAt manca, lo consideriamo "non scaduto" (legacy)
    });

    // 2) filtro eventi: se targetType=event deve esistere e non essere finished/cancelled
    const eventAds = pool.filter((a) => a?.targetType === "event" && a?.targetId);
    if (eventAds.length > 0) {
      const eventIds = Array.from(
        new Set(eventAds.map((a) => String(a.targetId)).filter(Boolean))
      );

      const events = await Event.find({ _id: { $in: eventIds } })
        .select("_id status canceledAt endedAt")
        .lean();

      const okEventIds = new Set(
        events
          .filter((ev) => {
            const st = String(ev?.status || "").toLowerCase();
            const isCanceled = Boolean(ev?.canceledAt) || st === "cancelled" || st === "canceled";
            const isFinished = Boolean(ev?.endedAt) || st === "finished" || st === "ended";
            return !isCanceled && !isFinished;
          })
          .map((ev) => String(ev._id))
      );

      pool = pool.filter((a) => {
        if (a?.targetType !== "event") return true;
        const tid = String(a?.targetId || "");
        return okEventIds.has(tid);
      });

      const removedEventAds = eventAds.filter((a) => !okEventIds.has(String(a.targetId)));
      if (removedEventAds.length > 0) {
        const badIds = removedEventAds.map((a) => a._id);
        Adv.updateMany({ _id: { $in: badIds } }, { $set: { isActive: false } }).catch(() => {});
      }
    }

    // 2b) filtro live: se targetType=liveRoom deve esistere e non essere finished/cancelled
    const liveAds = pool.filter((a) => a?.targetType === "liveRoom" && a?.targetId);
    if (liveAds.length > 0) {
      const liveIds = Array.from(
        new Set(liveAds.map((a) => String(a.targetId)).filter(Boolean))
      );

      const lives = await LiveRoom.find({ _id: { $in: liveIds } })
        .select("_id status canceledAt endedAt")
        .lean();

      const okLiveIds = new Set(
        lives
          .filter((lv) => {
            const st = String(lv?.status || "").toLowerCase();
            const isCanceled = Boolean(lv?.canceledAt) || st === "cancelled" || st === "canceled";
            const isFinished =
              Boolean(lv?.endedAt) || st === "finished" || st === "ended" || st === "closed";
            return !isCanceled && !isFinished;
          })
          .map((lv) => String(lv._id))
      );

      pool = pool.filter((a) => {
        if (a?.targetType !== "liveRoom") return true;
        const tid = String(a?.targetId || "");
        return okLiveIds.has(tid);
      });

      const removedLiveAds = liveAds.filter((a) => !okLiveIds.has(String(a.targetId)));
      if (removedLiveAds.length > 0) {
        const badIds = removedLiveAds.map((a) => a._id);
        Adv.updateMany({ _id: { $in: badIds } }, { $set: { isActive: false } }).catch(() => {});
      }
    }

    // 2.5) ENRICH payload (creator + event meta) so FE can render username/avatar/cover reliably
    {
      // A) preload creators for all ads
      const creatorIds = Array.from(
        new Set(pool.map((a) => String(a.creatorId || "")).filter(Boolean))
      );

      const creators = creatorIds.length
        ? await User.find({ _id: { $in: creatorIds } })
            .select("_id displayName avatar accountType role")
            .lean()
        : [];

      const creatorById = new Map(creators.map((u) => [String(u._id), u]));

      // B) preload event details for event-ads
      const eventIds = Array.from(
        new Set(
          pool
            .filter((a) => a?.targetType === "event" && a?.targetId)
            .map((a) => String(a.targetId))
            .filter(Boolean)
        )
      );

      const events = eventIds.length
        ? await Event.find({ _id: { $in: eventIds } })
            .select("_id title coverImage ticketPriceTokens contentScope creatorId status")
            .populate({ path: "creatorId", select: "displayName avatar accountType role" })
            .lean()
        : [];

      const eventById = new Map(events.map((ev) => [String(ev._id), ev]));

      // C) attach derived fields (do NOT break existing schema: add fields, don't rename)
      pool = pool.map((a) => {
        const adv = { ...a };

        // base creator (from adv.creatorId)
        const c = creatorById.get(String(adv.creatorId || ""));
        if (c) {
          adv.creatorName = String(c.displayName || "").trim();
          adv.creatorAvatarUrl = String(c.avatar || "").trim();
          adv.creatorAccountType = c.accountType || c.role || null;
        }

        // event override (richer + correct creator)
        if (adv.targetType === "event" && adv.targetId) {
          const ev = eventById.get(String(adv.targetId));
          if (ev) {
            // cover + pricing + scope from event if missing
            if (!adv.mediaUrl && ev.coverImage) adv.mediaUrl = ev.coverImage;
            if (adv.ticketPriceTokens == null && ev.ticketPriceTokens != null)
              adv.ticketPriceTokens = ev.ticketPriceTokens;
            if (!adv.contentScope && ev.contentScope) adv.contentScope = ev.contentScope;

            // strongest creator source: event.creatorId populated
            const ec = ev.creatorId && typeof ev.creatorId === "object" ? ev.creatorId : null;
            if (ec) {
              const dn = String(ec.displayName || "").trim();
              const av = String(ec.avatar || "").trim();
              if (dn) adv.creatorName = dn;
              if (av) adv.creatorAvatarUrl = av;
              adv.creatorAccountType = ec.accountType || ec.role || adv.creatorAccountType || null;
            }
          }
        }

        return adv;
      });
    }

    // 3) ranking
    pool.sort((a, b) => scoreAdv(b, ctx) - scoreAdv(a, ctx));

    const ads = pool.slice(0, maxAds);

    if (ads.length > 0) {
      const ids = ads.map((a) => a._id);
      await Adv.updateMany(
        { _id: { $in: ids } },
        { $inc: { impressions: 1 } }
      );
    }

    return res.status(200).json({
      status: 'success',
      data: ads,
    });
  } catch (err) {
    console.error('Errore serve ADV:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Internal error during ADV retrieval',
    });
  }
});

/**
 * GET /api/adv/serve-four?placement=feed&limit=4
 * Serve 4 ADV per widget DX con rotazione FAIR (NO ranking).
 */
router.get('/serve-four', auth, async (req, res) => {
  try {
    const placement = req.query.placement || 'feed';

    if (!req.user) {
      return res.status(401).json({ status: 'error', message: 'Authentication required' });
    }

    const userId = req.user._id;

    const dbUser = await User.findById(userId).select('accountType isVip appSettings.contentContext');
    if (!dbUser) {
      return res.status(401).json({ status: 'error', message: 'User not found' });
    }

    const blockedIds = await getBlockedUserIds(String(userId));
    const isAdminViewer = String(dbUser?.accountType || "").toLowerCase() === "admin";
    const hiddenCreatorIds = await getNonPublicCreatorIds({ isAdminViewer });

    const ctx = dbUser?.appSettings?.contentContext || DEFAULT_CONTEXT;

    const limit = Math.max(1, Math.min(4, parseInt(req.query.limit, 10) || 4));

    const now = new Date();

    const query2 = {
      isActive: true,
      reviewStatus: "approved",
      placement,
      creatorId: { $nin: [...blockedIds, ...hiddenCreatorIds] },
      ...activeWindowQuery(now),
    };

    // Neutral mode → NO HOT ads
    if (ctx === "neutral") {
      query2.contentScope = { $ne: "HOT" };
    }

    let pool = await Adv.find(query2).limit(200).lean();

    // 1) hard expiry filter
    pool = pool.filter((a) => {
      const ends = a?.endsAt ? new Date(a.endsAt) : null;
      return !ends || ends.getTime() > now.getTime();
    });

    // 2) filtro eventi: se targetType=event deve esistere e non essere finished/cancelled
    const eventAds = pool.filter((a) => a?.targetType === "event" && a?.targetId);
    if (eventAds.length > 0) {
      const eventIds = Array.from(new Set(eventAds.map((a) => String(a.targetId)).filter(Boolean)));

      const events = await Event.find({ _id: { $in: eventIds } })
        .select("_id status canceledAt endedAt")
        .lean();

      const okEventIds = new Set(
        events
          .filter((ev) => {
            const st = String(ev?.status || "").toLowerCase();
            const isCanceled = Boolean(ev?.canceledAt) || st === "cancelled" || st === "canceled";
            const isFinished = Boolean(ev?.endedAt) || st === "finished" || st === "ended";
            return !isCanceled && !isFinished;
          })
          .map((ev) => String(ev._id))
      );

      pool = pool.filter((a) => {
        if (a?.targetType !== "event") return true;
        return okEventIds.has(String(a?.targetId || ""));
      });

      const removedEventAds = eventAds.filter((a) => !okEventIds.has(String(a.targetId)));
      if (removedEventAds.length > 0) {
        const badIds = removedEventAds.map((a) => a._id);
        Adv.updateMany({ _id: { $in: badIds } }, { $set: { isActive: false } }).catch(() => {});
      }
    }

    // 2b) filtro live: se targetType=liveRoom deve esistere e non essere finished/cancelled
    const liveAds = pool.filter((a) => a?.targetType === "liveRoom" && a?.targetId);
    if (liveAds.length > 0) {
      const liveIds = Array.from(new Set(liveAds.map((a) => String(a.targetId)).filter(Boolean)));

      const lives = await LiveRoom.find({ _id: { $in: liveIds } })
        .select("_id status canceledAt endedAt")
        .lean();

      const okLiveIds = new Set(
        lives
          .filter((lv) => {
            const st = String(lv?.status || "").toLowerCase();
            const isCanceled = Boolean(lv?.canceledAt) || st === "cancelled" || st === "canceled";
            const isFinished =
              Boolean(lv?.endedAt) || st === "finished" || st === "ended" || st === "closed";
            return !isCanceled && !isFinished;
          })
          .map((lv) => String(lv._id))
      );

      pool = pool.filter((a) => {
        if (a?.targetType !== "liveRoom") return true;
        return okLiveIds.has(String(a?.targetId || ""));
      });

      const removedLiveAds = liveAds.filter((a) => !okLiveIds.has(String(a.targetId)));
      if (removedLiveAds.length > 0) {
        const badIds = removedLiveAds.map((a) => a._id);
        Adv.updateMany({ _id: { $in: badIds } }, { $set: { isActive: false } }).catch(() => {});
      }
    }

    // 2.5) ENRICH payload (creator + event meta) come /serve
    {
      const creatorIds = Array.from(new Set(pool.map((a) => String(a.creatorId || "")).filter(Boolean)));

      const creators = creatorIds.length
        ? await User.find({ _id: { $in: creatorIds } })
            .select("_id displayName avatar accountType role")
            .lean()
        : [];

      const creatorById = new Map(creators.map((u) => [String(u._id), u]));

      const evIds = Array.from(
        new Set(
          pool
            .filter((a) => a?.targetType === "event" && a?.targetId)
            .map((a) => String(a.targetId))
            .filter(Boolean)
        )
      );

      const events = evIds.length
        ? await Event.find({ _id: { $in: evIds } })
            .select("_id title coverImage ticketPriceTokens contentScope creatorId status")
            .populate({ path: "creatorId", select: "displayName avatar accountType role" })
            .lean()
        : [];

      const eventById = new Map(events.map((ev) => [String(ev._id), ev]));

      pool = pool.map((a) => {
        const adv = { ...a };

        const c = creatorById.get(String(adv.creatorId || ""));
        if (c) {
          adv.creatorName = String(c.displayName || "").trim();
          adv.creatorAvatarUrl = String(c.avatar || "").trim();
          adv.creatorAccountType = c.accountType || c.role || null;
        }

        if (adv.targetType === "event" && adv.targetId) {
          const ev = eventById.get(String(adv.targetId));
          if (ev) {
            if (!adv.mediaUrl && ev.coverImage) adv.mediaUrl = ev.coverImage;
            if (adv.ticketPriceTokens == null && ev.ticketPriceTokens != null)
              adv.ticketPriceTokens = ev.ticketPriceTokens;
            if (!adv.contentScope && ev.contentScope) adv.contentScope = ev.contentScope;

            const ec = ev.creatorId && typeof ev.creatorId === "object" ? ev.creatorId : null;
            if (ec) {
              const dn = String(ec.displayName || "").trim();
              const av = String(ec.avatar || "").trim();
              if (dn) adv.creatorName = dn;
              if (av) adv.creatorAvatarUrl = av;
              adv.creatorAccountType = ec.accountType || ec.role || adv.creatorAccountType || null;
            }
          }
        }

        return adv;
      });
    }

    // 3) FAIR selection (NO ranking): least impressions first, tie-break newest
    pool.sort((a, b) => {
      const ai = Number(a?.impressions || 0);
      const bi = Number(b?.impressions || 0);
      if (ai !== bi) return ai - bi;

      const ac = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bc = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bc - ac; // newest first
    });

    // unique by _id
    const seen = new Set();
    const picked = [];
    for (const it of pool) {
      const id = String(it?._id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      picked.push(it);
      if (picked.length >= limit) break;
    }

    if (picked.length > 0) {
      const ids = picked.map((a) => a._id);
      await Adv.updateMany({ _id: { $in: ids } }, { $inc: { impressions: 1 } });
    }

    return res.status(200).json({ status: 'success', data: picked });
  } catch (err) {
    console.error('Errore serve-four ADV:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Internal error during ADV retrieval',
    });
  }
});

/**
 * POST /api/adv/:id/click
 * Log molto semplice di un click su una ADV
 */
router.post('/:id/click', auth, async (req, res) => {
  try {
    const advId = req.params.id;

    const adv = await Adv.findByIdAndUpdate(
      advId,
      { $inc: { clicks: 1 } },
      { new: true }
    );

    if (!adv) {
      return res.status(404).json({
        status: 'error',
        message: 'ADV not found',
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        id: adv._id,
        clicks: adv.clicks,
      },
    });
  } catch (err) {
    console.error('Errore click ADV:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Internal error during click tracking',
    });
  }
});

module.exports = router;
