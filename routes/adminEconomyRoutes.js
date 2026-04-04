// routes/adminEconomyRoutes.js
const express = require("express");
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");
const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");
const Event = require("../models/event");
const Notification = require("../models/notification");
const AdminAuditLog = require("../models/AdminAuditLog");
const ActionAuditLog = require("../models/ActionAuditLog");
const Ticket = require("../models/ticket");
const RefundLog = require("../models/RefundLog");
const { appendAccountTrustEvent } = require("../services/accountTrustRecordService");

const {
  freezeNativePrivateHeldEvent,
  refundNativePrivateHeldOrFrozenEvent,
} = require("../services/nativePrivateEconomicService");

const router = express.Router();

// GET /api/admin/economy/summary (admin-only)
router.get("/summary", auth, adminGuard, async (req, res) => {
  try {
    const usersAgg = await User.aggregate([
      {
        $group: {
          _id: null,
          circulatingTokens: { $sum: "$tokenBalance" },
          redeemableTokens: { $sum: "$tokenEarnings" },
        },
      },
    ]);

    const circulatingTokens = usersAgg?.[0]?.circulatingTokens || 0;
    const redeemableTokens = usersAgg?.[0]?.redeemableTokens || 0;
    const nonRedeemableTokens = Math.max(0, circulatingTokens - redeemableTokens);

    const sumTx = async (match) => {
      const out = await TokenTransaction.aggregate([
        { $match: match },
        { $group: { _id: null, total: { $sum: "$amountTokens" } } },
      ]);
      return out?.[0]?.total || 0;
    };

    const platformIncomeTokens = await sumTx({
      kind: { $in: ["vip", "adv_slot", "showcase"] },
    });

    const purchasedTokens = await sumTx({
      kind: "purchase",
      direction: "credit",
    });

    const paidOutTokens = await sumTx({
      kind: "payout",
      direction: "debit",
    });

    return res.json({
      status: "ok",
      data: {
        circulatingTokens,
        redeemableTokens,
        nonRedeemableTokens,
        platformIncomeTokens,
        purchasedTokens,
        paidOutTokens,
      },
    });
  } catch (e) {
    console.error("admin economy summary error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// GET /api/admin/economy/native-private-review
router.get("/native-private-review", auth, adminGuard, async (req, res) => {
  try {
    const allowedStatuses = ["held", "frozen"];
    const requestedStatus = String(req.query.status || "").trim().toLowerCase();
    const statusFilter = allowedStatuses.includes(requestedStatus)
      ? requestedStatus
      : { $in: allowedStatuses };

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

    const events = await Event.find({
      accessScope: "private",
      status: "finished",
      "privateSession.economicStatus": statusFilter,
    })
      .sort({
        "privateSession.economicReleaseEligibleAt": 1,
        updatedAt: -1,
      })
      .limit(limit)
      .populate({
        path: "creatorId",
        select: "displayName email accountType isCreator creatorEnabled payoutEnabled payoutStatus",
      })
      .lean();

    const data = events.map((event) => ({
      eventId: event._id,
      title: event.title || "",
      status: event.status,
      creator: event.creatorId
        ? {
            id: event.creatorId._id,
            displayName: event.creatorId.displayName || "",
            email: event.creatorId.email || "",
            accountType: event.creatorId.accountType || null,
            isCreator: event.creatorId.isCreator === true,
            creatorEnabled: event.creatorId.creatorEnabled === true,
            payoutEnabled: event.creatorId.payoutEnabled === true,
            payoutStatus: event.creatorId.payoutStatus || "none",
          }
        : null,
      privateEconomic: {
        status: event.privateSession?.economicStatus || "none",
        heldTokens: Number(event.privateSession?.economicHeldTokens || 0),
        heldAt: event.privateSession?.economicHeldAt || null,
        releaseEligibleAt: event.privateSession?.economicReleaseEligibleAt || null,
        releasedAt: event.privateSession?.economicReleasedAt || null,
        frozenAt: event.privateSession?.economicFrozenAt || null,
        refundedAt: event.privateSession?.economicRefundedAt || null,
        resolutionReason: event.privateSession?.economicResolutionReason || null,
      },
      roomId: event.privateSession?.roomId || null,
      ticketPriceTokens: Number(event.ticketPriceTokens || 0),
      maxSeats: Number(event.maxSeats || 0),
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    }));

    return res.json({
      status: "ok",
      data,
    });
  } catch (e) {
    console.error("admin native private review list error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/admin/economy/native-private/:eventId/freeze
router.post("/native-private/:eventId/freeze", auth, adminGuard, async (req, res) => {
  try {
    const adminId = req.user?._id || null;
    const eventId = req.params.eventId;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_EVENT_ID",
        message: "Invalid event ID",
      });
    }

    const now = new Date();
    const reasonRaw = String(req.body?.reason || "").trim();
    const freezeReason = reasonRaw ? reasonRaw.slice(0, 200) : "ADMIN_FROZEN";

    const beforeEvent = await Event.findById(eventId)
      .populate({
        path: "creatorId",
        select: "_id displayName email",
      })
      .lean();

    if (!beforeEvent) {
      return res.status(404).json({
        status: "error",
        code: "EVENT_NOT_FOUND",
        message: "Event not found",
      });
    }

    const freezeResult = await freezeNativePrivateHeldEvent({
      eventId,
      adminId,
      now,
      reason: freezeReason,
    });

    const frozenEvent = await Event.findById(eventId)
      .populate({
        path: "creatorId",
        select: "_id displayName email",
      })
      .lean();

    if (freezeResult?.processed && !freezeResult?.alreadyFrozen) {
      try {
        const creatorId = frozenEvent?.creatorId?._id || frozenEvent?.creatorId || null;

        if (creatorId) {
          await appendAccountTrustEvent({
            userId: creatorId,
            kind: "private_funds_frozen",
            byAdminId: adminId,
            targetType: "event",
            targetId: frozenEvent?._id || eventId,
            eventId: frozenEvent?._id || eventId,
            note: freezeReason,
            reasonCode: "PRIVATE_FUNDS_FROZEN",
            at: frozenEvent?.privateSession?.economicFrozenAt || now,
          });
        }
      } catch (e) {
        console.error("account trust freeze failed:", e?.message || e);
      }
      try {
        await AdminAuditLog.create({
          adminId,
          actionType: "ADMIN_PRIVATE_FUNDS_FROZEN",
          targetType: "event",
          targetId: String(eventId),
          meta: {
            reason: freezeReason,
            economicStatusBefore: freezeResult?.statusBefore || null,
            economicStatusAfter: freezeResult?.statusAfter || "frozen",
            heldTokens: Number(frozenEvent?.privateSession?.economicHeldTokens || 0),
          },
        });
      } catch (e) {
        console.error("ADMIN_PRIVATE_FUNDS_FROZEN audit failed:", e?.message || e);
      }

      try {
        await ActionAuditLog.create({
          actorId: adminId,
          actorRole: "admin",
          actionType: "ADMIN_PRIVATE_FUNDS_FROZEN",
          targetType: "event",
          targetId: String(eventId),
          reason: freezeReason,
          meta: {
            economicStatusBefore: freezeResult?.statusBefore || null,
            economicStatusAfter: freezeResult?.statusAfter || "frozen",
          },
          ip: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        });
      } catch (e) {
        console.error("ACTION audit freeze failed:", e?.message || e);
      }

      try {
        const creatorId = frozenEvent?.creatorId?._id || frozenEvent?.creatorId || null;

        if (creatorId) {
          await Notification.updateOne(
            { dedupeKey: `private_funds_frozen:creator:${eventId}` },
            {
              $setOnInsert: {
                userId: creatorId,
                actorId: adminId,
                type: "SYSTEM_PRIVATE_FUNDS_FROZEN",
                targetType: "event",
                targetId: frozenEvent._id,
                message: "Funds for a private event have been frozen for admin review",
                isPersistent: true,
                data: {
                  eventId: frozenEvent._id,
                  economicStatus: "frozen",
                  heldTokens: Number(frozenEvent?.privateSession?.economicHeldTokens || 0),
                  reason: freezeReason,
                  frozenAt: frozenEvent?.privateSession?.economicFrozenAt || now,
                },
                dedupeKey: `private_funds_frozen:creator:${eventId}`,
              },
            },
            { upsert: true }
          );
        }
      } catch (e) {
        console.error("freeze creator notification failed:", e?.message || e);
      }

      try {
        const ticketHolders = await require("../models/ticket").distinct("userId", {
          eventId: frozenEvent._id,
          scope: "private",
          roomId: frozenEvent?.privateSession?.roomId || null,
          status: "active",
        });

        if (Array.isArray(ticketHolders) && ticketHolders.length > 0) {
          await Promise.all(
            ticketHolders.map((uid) =>
              Notification.updateOne(
                { dedupeKey: `private_funds_frozen:buyer:${eventId}:${String(uid)}` },
                {
                  $setOnInsert: {
                    userId: uid,
                    actorId: adminId,
                    type: "SYSTEM_PRIVATE_FUNDS_FROZEN",
                    targetType: "event",
                    targetId: frozenEvent._id,
                    message: "Payment for a private event is under admin review",
                    isPersistent: true,
                    data: {
                      eventId: frozenEvent._id,
                      economicStatus: "frozen",
                      reason: freezeReason,
                      frozenAt: frozenEvent?.privateSession?.economicFrozenAt || now,
                    },
                    dedupeKey: `private_funds_frozen:buyer:${eventId}:${String(uid)}`,
                  },
                },
                { upsert: true }
              )
            )
          );
        }
      } catch (e) {
        console.error("freeze buyer notifications failed:", e?.message || e);
      }
    }

    return res.json({
      status: "ok",
      data: {
        eventId: frozenEvent?._id || eventId,
        economicStatus: frozenEvent?.privateSession?.economicStatus || "none",
        heldTokens: Number(frozenEvent?.privateSession?.economicHeldTokens || 0),
        heldAt: frozenEvent?.privateSession?.economicHeldAt || null,
        frozenAt: frozenEvent?.privateSession?.economicFrozenAt || null,
        releaseEligibleAt: frozenEvent?.privateSession?.economicReleaseEligibleAt || null,
        resolutionReason: frozenEvent?.privateSession?.economicResolutionReason || null,
        alreadyFrozen: freezeResult?.alreadyFrozen === true,
      },
    });
  } catch (e) {
    if (e?.httpStatus && e?.payload) {
      return res.status(e.httpStatus).json(e.payload);
    }

    console.error("admin native private freeze error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/admin/economy/native-private/:eventId/refund
router.post("/native-private/:eventId/refund", auth, adminGuard, async (req, res) => {
  try {
    const adminId = req.user?._id || null;
    const eventId = req.params.eventId;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_EVENT_ID",
        message: "Invalid event ID",
      });
    }

    const now = new Date();
    const reasonRaw = String(req.body?.reason || "").trim();
    const refundReason = reasonRaw ? reasonRaw.slice(0, 200) : "ADMIN_REFUND";

    const beforeEvent = await Event.findById(eventId)
      .populate({
        path: "creatorId",
        select: "_id displayName email",
      })
      .lean();

    if (!beforeEvent) {
      return res.status(404).json({
        status: "error",
        code: "EVENT_NOT_FOUND",
        message: "Event not found",
      });
    }

    const refundResult = await refundNativePrivateHeldOrFrozenEvent({
      eventId,
      adminId,
      now,
      reason: refundReason,
    });

    const refundedEvent = await Event.findById(eventId)
      .populate({
        path: "creatorId",
        select: "_id displayName email",
      })
      .lean();

    if (refundResult?.processed && !refundResult?.alreadyRefunded) {
      try {
        const creatorId = refundedEvent?.creatorId?._id || refundedEvent?.creatorId || null;

        if (creatorId) {
          await appendAccountTrustEvent({
            userId: creatorId,
            kind: "private_funds_refunded",
            byAdminId: adminId,
            targetType: "event",
            targetId: refundedEvent?._id || eventId,
            eventId: refundedEvent?._id || eventId,
            note: refundReason,
            reasonCode: "PRIVATE_FUNDS_REFUNDED",
            at: refundedEvent?.privateSession?.economicRefundedAt || now,
          });
        }
      } catch (e) {
        console.error("account trust refund failed:", e?.message || e);
      }
      try {
        await AdminAuditLog.create({
          adminId,
          actionType: "ADMIN_PRIVATE_FUNDS_REFUNDED",
          targetType: "event",
          targetId: String(eventId),
          meta: {
            reason: refundReason,
            economicStatusBefore: refundResult?.statusBefore || null,
            economicStatusAfter: refundResult?.statusAfter || "refunded",
            refundedCount: Number(refundResult?.refundedCount || 0),
            refundedTokens: Number(refundResult?.refundedTokens || 0),
          },
        });
      } catch (e) {
        console.error("ADMIN_PRIVATE_FUNDS_REFUNDED audit failed:", e?.message || e);
      }

      try {
        await ActionAuditLog.create({
          actorId: adminId,
          actorRole: "admin",
          actionType: "ADMIN_PRIVATE_FUNDS_REFUNDED",
          targetType: "event",
          targetId: String(eventId),
          reason: refundReason,
          meta: {
            economicStatusBefore: refundResult?.statusBefore || null,
            economicStatusAfter: refundResult?.statusAfter || "refunded",
            refundedCount: Number(refundResult?.refundedCount || 0),
            refundedTokens: Number(refundResult?.refundedTokens || 0),
          },
          ip: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        });
      } catch (e) {
        console.error("ACTION audit refund failed:", e?.message || e);
      }

      try {
        const creatorId = refundedEvent?.creatorId?._id || refundedEvent?.creatorId || null;

        if (creatorId) {
          await Notification.updateOne(
            { dedupeKey: `private_funds_refunded:creator:${eventId}` },
            {
              $setOnInsert: {
                userId: creatorId,
                actorId: adminId,
                type: "SYSTEM_PRIVATE_FUNDS_REFUNDED",
                targetType: "event",
                targetId: refundedEvent._id,
                message: "Funds for a private event have been refunded by admin decision",
                isPersistent: true,
                data: {
                  eventId: refundedEvent._id,
                  economicStatus: "refunded",
                  refundedTokens: Number(refundResult?.refundedTokens || 0),
                  reason: refundReason,
                  refundedAt: refundedEvent?.privateSession?.economicRefundedAt || now,
                },
                dedupeKey: `private_funds_refunded:creator:${eventId}`,
              },
            },
            { upsert: true }
          );
        }
      } catch (e) {
        console.error("refund creator notification failed:", e?.message || e);
      }

      try {
        const refundedTickets = await Ticket.find({
          eventId: refundedEvent._id,
          scope: "private",
          roomId: refundedEvent?.privateSession?.roomId || null,
          status: "refunded",
        })
          .select("userId priceTokens _id")
          .lean();

        for (const t of refundedTickets) {
          await Notification.updateOne(
            { dedupeKey: `private_funds_refunded:buyer:${eventId}:${String(t.userId)}` },
            {
              $setOnInsert: {
                userId: t.userId,
                actorId: adminId,
                type: "SYSTEM_PRIVATE_FUNDS_REFUNDED",
                targetType: "event",
                targetId: refundedEvent._id,
                message: "Payment for a private event has been refunded by admin decision",
                isPersistent: true,
                data: {
                  eventId: refundedEvent._id,
                  ticketId: t._id,
                  refundedTokens: Number(t.priceTokens || 0),
                  economicStatus: "refunded",
                  reason: refundReason,
                  refundedAt: refundedEvent?.privateSession?.economicRefundedAt || now,
                },
                dedupeKey: `private_funds_refunded:buyer:${eventId}:${String(t.userId)}`,
              },
            },
            { upsert: true }
          );

          await RefundLog.updateOne(
            {
              type: "manual_refund",
              userId: t.userId,
              referenceType: "event",
              referenceId: String(refundedEvent._id),
              reasonCode: "MANUAL_APPROVED",
            },
            {
              $setOnInsert: {
                type: "manual_refund",
                userId: t.userId,
                amountTokens: Number(t.priceTokens || 0),
                currency: "token",
                reasonCode: "MANUAL_APPROVED",
                referenceType: "event",
                referenceId: String(refundedEvent._id),
                createdByAdminId: adminId,
                resolved: true,
              },
            },
            { upsert: true }
          );
        }
      } catch (e) {
        console.error("refund buyer notifications/logs failed:", e?.message || e);
      }
    }

    return res.json({
      status: "ok",
      data: {
        eventId: refundedEvent?._id || eventId,
        economicStatus: refundedEvent?.privateSession?.economicStatus || "none",
        heldTokens: Number(refundedEvent?.privateSession?.economicHeldTokens || 0),
        heldAt: refundedEvent?.privateSession?.economicHeldAt || null,
        frozenAt: refundedEvent?.privateSession?.economicFrozenAt || null,
        refundedAt: refundedEvent?.privateSession?.economicRefundedAt || null,
        releaseEligibleAt: refundedEvent?.privateSession?.economicReleaseEligibleAt || null,
        resolutionReason: refundedEvent?.privateSession?.economicResolutionReason || null,
        refundedCount: Number(refundResult?.refundedCount || 0),
        refundedTokens: Number(refundResult?.refundedTokens || 0),
        alreadyRefunded: refundResult?.alreadyRefunded === true,
      },
    });
  } catch (e) {
    if (e?.httpStatus && e?.payload) {
      return res.status(e.httpStatus).json(e.payload);
    }

    console.error("admin native private refund error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;