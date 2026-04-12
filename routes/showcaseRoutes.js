// routes/showcaseRoutes.js
const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const ShowcaseItem = require("../models/showcaseItem");
const User = require("../models/user");
const Notification = require("../models/notification");
const { getBlockedUserIds } = require("../utils/blockUtils");
const TokenTransaction = require("../models/tokenTransaction");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { reserveUserTokensBuckets } = require("../services/tokenDebitService");
const featureGuard = require("../middleware/featureGuard");

// --- VETRINA rules ---
const VETRINA_FREE_ACTIVE = 2;
const VETRINA_PAID_PRICE_TOKENS = 30;
const VETRINA_DURATION_DAYS = 7;

function logShowcaseFlow(stage, payload = {}) {
  try {
    console.log(
      `[SHOWCASE][${stage}]`,
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      })
    );
  } catch {
    console.log(`[SHOWCASE][${stage}]`, payload);
  }
}

function genOpId() {
  return `showcase_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function activeWindowQuery(now = new Date()) {
  return {
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  };
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
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

async function ensureVipOnly(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ status: "error", message: "Authentication required" });
    }

    const userId = req.user._id;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Invalid token" });
    }

    // admin ok + vip ok (creator NON basta)
    const user = await User.findById(userId).select("accountType isVip");
    if (!user) {
      return res.status(401).json({ status: "error", message: "User not found" });
    }

    const accountType = user.accountType || "base";
    const isVip = user.isVip === true;

    if (accountType === "admin" || isVip) return next();

    return res.status(403).json({
      status: "error",
      message: "Only VIPs can publish in Showcase",
    });
  } catch (err) {
    console.error("Errore ensureVipOnly:", err);
    return res.status(500).json({ status: "error", message: "Internal error in Vetrina permissions" });
  }
}

/**
 * POST /api/showcase/item
 * Crea un item Vetrina (pending).
 * Regola: 2 slot free attivi (approved). Oltre -> paid (30 token) con conferma.
 * Pagamento: NON qui. Si scala token SOLO in admin approve (come ADV).
 */
router.post("/item", auth, featureGuard("tokens"), ensureVipOnly, async (req, res) => {
  try {
    const body = req.body || {};

    logShowcaseFlow("START", {
      route: "POST /api/showcase/item",
      userId: String(req.user?._id || ""),
      title: String(body.title || "").trim().slice(0, 80),
      confirmPaid: body.confirmPaid === true || String(body.confirmPaid).toLowerCase() === "true",
      opId: String(body.opId || "").trim() || null,
    });

    const title = body.title;
    const text = body.text ?? "";
    const mediaUrl = body.mediaUrl ?? "";
    const languages = body.languages ?? [];
    const countries = body.countries ?? [];
    const confirmPaid = body.confirmPaid ?? false;
    const opId = body.opId;

    if (!title) {
      return res.status(400).json({
        status: "error",
        message: "Body missing or incomplete (title)",
      });
    }

    const creatorId = req.user._id;

    const now = new Date();
    const safeOpId = String(opId || "").trim() || genOpId();
    // ✅ Regola anti-spam: max 2 richieste FREE in pending
    const freePendingCount = await ShowcaseItem.countDocuments({
      creatorId,
      isActive: true,
      reviewStatus: "pending",
      billingType: "free",
    });

    if (freePendingCount >= VETRINA_FREE_ACTIVE) {
      logShowcaseFlow("ERROR", {
        route: "POST /api/showcase/item",
        userId: String(creatorId),
        code: "VETRINA_TOO_MANY_PENDING",
        freePendingCount,
      });

      return res.status(409).json({
        status: "error",
        code: "VETRINA_TOO_MANY_PENDING",
        message: "You already have 2 pending Showcase requests. Please wait for approval before sending another one.",
      });
    }

    // Conteggio slot gratuiti: item APPROVATI e ATTIVI (non pending), non scaduti
    const freeActiveCount = await ShowcaseItem.countDocuments({
      creatorId,
      isActive: true,
      reviewStatus: "approved",
      billingType: "free",
      $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
    });

    let billingType = "free";
    let paidTokens = 0;
    let holdGroupId = null;

    if (freeActiveCount >= VETRINA_FREE_ACTIVE) {
      billingType = "paid";
      paidTokens = VETRINA_PAID_PRICE_TOKENS;

      // check saldo (solo per evitare che confermi inutilmente)
      const me = await User.findById(creatorId)
        .select("tokenPurchased tokenEarnings tokenRedeemable")
        .lean();

      const spendable =
        Number(me?.tokenPurchased || 0) +
        Number(me?.tokenEarnings || 0) +
        Number(me?.tokenRedeemable || 0);

      if (spendable < paidTokens) {
        logShowcaseFlow("ERROR", {
          route: "POST /api/showcase/item",
          userId: String(creatorId),
          code: "INSUFFICIENT_TOKENS",
          spendable,
          requiredTokens: paidTokens,
        });

        return res.status(403).json({
          status: "error",
          code: "INSUFFICIENT_TOKENS",
          message: `Not enough tokens. Required: ${paidTokens}.`,
        });
      }

      const confirmed = String(confirmPaid).toLowerCase() === "true" || confirmPaid === true;
      if (!confirmed) {
        logShowcaseFlow("ERROR", {
          route: "POST /api/showcase/item",
          userId: String(creatorId),
          code: "VETRINA_PAYMENT_REQUIRED",
          requiredTokens: paidTokens,
        });

        return res.status(409).json({
          status: "error",
          code: "VETRINA_PAYMENT_REQUIRED",
          priceTokens: paidTokens,
          message: `You already have two active products in your Showcase. This slot is paid (${paidTokens} token / 7 days). Do you want to proceed?`,
        });
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const reserve = await reserveUserTokensBuckets({
            userId: creatorId,
            amountTokens: paidTokens,
            session,
          });

          if (!reserve.ok) {
            logShowcaseFlow("ERROR", {
              route: "POST /api/showcase/item",
              userId: String(creatorId),
              code: "SHOWCASE_HOLD_RESERVE_FAILED",
              requiredTokens: paidTokens,
              opId: safeOpId,
            });

            const err = new Error("Not enough tokens.");
            err.statusCode = 403;
            throw err;
          }

          holdGroupId = `grp_${crypto.randomUUID()}`;

          await TokenTransaction.create(
            [
              {
                opId: safeOpId,
                groupId: holdGroupId,
                fromUserId: creatorId,
                toUserId: null,
                kind: "showcase_hold",
                direction: "debit",
                context: "showcase",
                amountTokens: paidTokens,
                amountEuro: 0,
                metadata: {
                  reason: "showcase_hold",
                  showcaseOpId: safeOpId,
                  movedFromPurchased: reserve.movedFromPurchased,
                  movedFromEarnings: reserve.movedFromEarnings,
                  movedFromRedeemable: reserve.movedFromRedeemable,
                },
              },
            ],
            { session }
          );
        });
      } finally {
        session.endSession();
      }
    }

    const item = await ShowcaseItem.create({
      creatorId,
      opId: safeOpId,
      title: String(title).trim(),
      text: text ? String(text).trim() : "",
      mediaUrl: mediaUrl ? String(mediaUrl).trim() : "",
      startsAt: null,
      endsAt: null,
      languages,
      countries,
      isActive: true,
      billingType,
      paidTokens,
      reviewStatus: "pending",
      holdTokens: billingType === "paid" ? paidTokens : 0,
      holdStatus: billingType === "paid" ? "held" : "none",
    });

    // 🔔 Admin queue unica: VETRINA pending
    try {
      await Notification.create({
        userId: null,
        actorId: creatorId,
        type: "ADMIN_VETRINA_PENDING",
        targetType: "showcase",
        targetId: item._id,
        message: `New Showcase item pending approval (${item.title || "no title"}).`,
        data: {
          itemId: String(item._id),
          creatorId: String(creatorId),
          billingType: item.billingType,
          paidTokens: item.paidTokens || 0,
          startsAt: item.startsAt || null,
          endsAt: item.endsAt || null,
        },
        isPersistent: false,
        dedupeKey: `admin:showcase:${item._id}:pending`,
      });
    } catch (e) {
      if (e?.code !== 11000) console.error("Admin notification Vetrina pending error:", e);
    }

    logShowcaseFlow("SUCCESS", {
      route: "POST /api/showcase/item",
      userId: String(creatorId),
      itemId: String(item._id),
      opId: safeOpId,
      billingType,
      paidTokens,
      holdStatus: item.holdStatus,
      reviewStatus: item.reviewStatus,
    });

    return res.status(201).json({ status: "success", data: item });
  } catch (err) {
    logShowcaseFlow("ERROR", {
      route: "POST /api/showcase/item",
      userId: String(req.user?._id || ""),
      message: err?.message || "unknown_error",
      statusCode: err?.statusCode || 500,
      stack: err?.stack || null,
    });

    console.error("Errore creazione Vetrina:", err);
    return res.status(500).json({ status: "error", message: "Internal error creating Showcase" });
  }
});

/**
 * GET /api/showcase/serve
 * Serve 1 item Vetrina per colonna DX (rotation)
 * - solo approved + attivi + finestra valida
 * - exclude blocked creators
 * - increment impressions (solo su item servito)
 */
/**
 * GET /api/showcase/serve
 * Serve 1 item Vetrina per colonna DX (FAIR rotation)
 * - solo approved + attivi + finestra valida
 * - exclude blocked creators
 * - pick least viewed (impressions asc), tie-break newest
 * - increment impressions (solo su item servito)
 */
router.get("/serve", auth, async (req, res) => {
  try {
    const now = new Date();

    const meId = String(req.user?._id || req.user?.id || "");
    const blockedIds = meId ? await getBlockedUserIds(meId) : [];
    const isAdminViewer = String(req.user?.accountType || "").toLowerCase() === "admin";
    const hiddenCreatorIds = await getNonPublicCreatorIds({ isAdminViewer });

    const raw = await ShowcaseItem.findOne({
      isActive: true,
      reviewStatus: "approved",
      creatorId: { $nin: [...blockedIds, ...hiddenCreatorIds] },
      ...activeWindowQuery(now),
    })
      .populate({ path: "creatorId", select: "displayName avatar accountType role" })
      .sort({ impressions: 1, createdAt: -1 })
      .lean();

    if (!raw) {
      return res.status(200).json({ status: "success", data: null });
    }

    await ShowcaseItem.updateOne({ _id: raw._id }, { $inc: { impressions: 1 } });

    const c = raw.creatorId || null;
    const displayName = String(c?.displayName || "").trim();
    const avatar = String(c?.avatar || "").trim();

    const item = {
      id: raw._id,
      title: raw.title,
      text: raw.text || "",
      mediaUrl: raw.mediaUrl || "",
      startsAt: raw.startsAt || null,
      endsAt: raw.endsAt || null,
      billingType: raw.billingType || "free",
      paidTokens: Number(raw.paidTokens || 0),
      impressions: Number(raw.impressions || 0) + 1, // riflette l'incremento appena fatto
      clicks: Number(raw.clicks || 0),
      creator: c
        ? {
            id: c._id,
            displayName,
            avatar,
            accountType: c.accountType || c.role || null,
          }
        : null,
    };

    return res.status(200).json({ status: "success", data: item });
  } catch (err) {
    console.error("Errore serve Vetrina:", err);
    return res.status(500).json({ status: "error", message: "Internal error serving Showcase" });
  }
});

/**
 * GET /api/showcase/all
 * Lista approvati (expand) - paginata
 */
router.get("/all", auth, async (req, res) => {
  try {
    const now = new Date();

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const skip = (page - 1) * limit;

    const meId = String(req.user?._id || req.user?.id || "");
    const blockedIds = meId ? await getBlockedUserIds(meId) : [];
    const isAdminViewer = String(req.user?.accountType || "").toLowerCase() === "admin";
    const hiddenCreatorIds = await getNonPublicCreatorIds({ isAdminViewer });

    const q = {
      isActive: true,
      reviewStatus: "approved",
      creatorId: { $nin: [...blockedIds, ...hiddenCreatorIds] },
      ...activeWindowQuery(now),
    };

    const [total, itemsRaw] = await Promise.all([
      ShowcaseItem.countDocuments(q),
      ShowcaseItem.find(q)
        .populate({ path: "creatorId", select: "displayName avatar accountType role" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const items = (itemsRaw || []).map((it) => {
      const c = it.creatorId || null;
      const displayName = String(c?.displayName || "").trim();
      const avatar = String(c?.avatar || "").trim();

      return {
        id: it._id,
        title: it.title,
        text: it.text || "",
        mediaUrl: it.mediaUrl || "",
        startsAt: it.startsAt || null,
        endsAt: it.endsAt || null,
        billingType: it.billingType || "free",
        paidTokens: Number(it.paidTokens || 0),
        impressions: Number(it.impressions || 0),
        clicks: Number(it.clicks || 0),
        creator: c
          ? {
              id: c._id,
              displayName,
              avatar,
              accountType: c.accountType || c.role || null,
            }
          : null,
      };
    });

    return res.status(200).json({
      status: "success",
      page,
      limit,
      total,
      data: items,
    });
  } catch (err) {
    console.error("Errore list all Vetrina:", err);
    return res.status(500).json({ status: "error", message: "Internal error listing Showcase" });
  }
});

/**
 * POST /api/showcase/:id/click
 * Traccia click e restituisce redirect interno (profilo owner)
 */
router.post("/:id/click", auth, async (req, res) => {
  try {
    const itemId = req.params.id;

    const item = await ShowcaseItem.findById(itemId).select("creatorId clicks");

    if (!item) {
      return res.status(404).json({ status: "error", message: "Showcase item not found" });
    }

    const isAdminViewer = String(req.user?.accountType || "").toLowerCase() === "admin";

    const creator = await User.findById(item.creatorId)
      .select("_id accountType isBanned isDeleted deletedAt")
      .lean();

    if (!creator) {
      return res.status(404).json({ status: "error", message: "Showcase item not found" });
    }

    if (
      !isAdminViewer &&
      (
        creator?.accountType === "admin" ||
        creator?.isBanned === true ||
        isUserDeletedLike(creator)
      )
    ) {
      return res.status(404).json({ status: "error", message: "Showcase item not found" });
    }

    await ShowcaseItem.updateOne(
      { _id: itemId },
      { $inc: { clicks: 1 } }
    );

    // 👉 redirect interno al profilo owner (decidi tu il path esatto del frontend)
    const creatorId = String(item.creatorId || "");

    return res.status(200).json({
      status: "success",
      data: {
        id: item._id,
        clicks: Number(item.clicks || 0) + 1,
        creatorId,
      },
    });
  } catch (err) {
    console.error("Errore click Vetrina:", err);
    return res.status(500).json({ status: "error", message: "Internal error in Showcase click" });
  }
});

module.exports = router;
