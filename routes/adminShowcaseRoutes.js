const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const ShowcaseItem = require("../models/showcaseItem");
const User = require("../models/user");
const Notification = require("../models/notification");
const TokenTransaction = require("../models/tokenTransaction");
const AdminAuditLog = require("../models/AdminAuditLog");

const VETRINA_DURATION_DAYS = 7;

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function groupIdFor(itemId) {
  return `showcase_${String(itemId)}_${Date.now()}`;
}

function opIdFor(item) {
  const base = item?.opId ? String(item.opId) : null;
  return base || `showcase_admin_${String(item._id)}_${Date.now()}`;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).trim();
  return req.ip || null;
}

async function logAdminShowcaseDecision(req, itemId, creatorId, decision, reason) {
  try {
    if (!req.user?._id) return;

    await AdminAuditLog.create({
      adminId: req.user._id,
      actionType: "ADMIN_SHOWCASE_DECISION",
      targetType: "showcase",
      targetId: String(itemId),
      meta: {
        decision: decision || null, // "approve" | "reject"
        reason: reason || null,     // adminNote (reject) o null
        creatorId: creatorId ? String(creatorId) : null,
        ip: getClientIp(req),
        userAgent: (req.headers["user-agent"] || "").toString().slice(0, 500) || null,
      },
    });
  } catch (e) {
    console.error("AdminAuditLog (showcase decision) write failed:", e?.message || e);
  }
}

/**
 * GET /api/admin/showcase/pending
 */
router.get("/showcase/pending", auth, adminGuard, async (req, res) => {
  try {
    const items = await ShowcaseItem.find({ reviewStatus: "pending" })
      .populate({ path: "creatorId", select: "displayName avatar accountType isVip tokenBalance tokenHeld" })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ status: "success", data: items });
  } catch (err) {
    console.error("admin showcase pending error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/showcase/:id/approve
 * - status=approved
 * - startsAt=now, endsAt=now+7d
 * - if paid+held => charge tokens (tokenHeld--, tokenBalance--) + ledger showcase_charge
 * - notify: "Showcase approved."
 */
router.patch("/showcase/:id/approve", auth, adminGuard, async (req, res) => {
  try {
    const adminId = req.user?._id;
    const itemId = req.params.id;

    const item = await ShowcaseItem.findById(itemId).select(
      "creatorId title billingType paidTokens holdTokens holdStatus opId reviewStatus chargedGroupId"
    );
    if (!item) return res.status(404).json({ status: "error", message: "Showcase item not found" });

    if (item.reviewStatus !== "pending") {
      return res.status(409).json({ status: "error", message: "Showcase item is not pending" });
    }

    const now = new Date();
    const startsAt = now;
    const endsAt = addDays(now, VETRINA_DURATION_DAYS);

    // --- paid charge (if held)
    if (item.billingType === "paid") {
      const charge = Number(item.holdTokens || item.paidTokens || 0);

      if (charge > 0 && item.holdStatus === "held") {
        // Decrement held + decrement balance atomico (condizionato)
        const u = await User.findOneAndUpdate(
          {
            _id: item.creatorId,
            tokenHeld: { $gte: charge },
            tokenBalance: { $gte: charge },
          },
          {
            $inc: { tokenHeld: -charge, tokenBalance: -charge },
          },
          { new: true }
        ).select("_id tokenBalance tokenHeld");

        if (!u) {
          return res.status(409).json({
            status: "error",
            message: "Cannot charge tokens (insufficient balance/held).",
          });
        }

        // Ledger: charge
        try {
          const gid = groupIdFor(item._id);

          await TokenTransaction.create({
            opId: opIdFor(item),
            groupId: gid,
            fromUserId: item.creatorId,
            toUserId: null,
            kind: "showcase_charge",
            direction: "debit",
            context: "showcase",
            contextId: String(item._id),
            amountTokens: charge,
            amountEuro: 0,
            metadata: { reason: "showcase_charge", itemId: String(item._id) },
          });

          item.chargedGroupId = gid;
        } catch (e) {
          // se ledger fallisce, NON annulliamo la charge (coerenza economica > ledger)
          console.error("showcase_charge tx error:", e);
        }

        item.holdStatus = "charged";
        item.holdTokens = 0;
      }
    }

    item.reviewStatus = "approved";
    item.reviewedBy = adminId;
    item.reviewedAt = now;
    item.reviewNote = null;
    item.startsAt = startsAt;
    item.endsAt = endsAt;

    await item.save();

    // Notify user
    try {
      await Notification.create({
        userId: item.creatorId,
        actorId: adminId,
        type: "VETRINA_APPROVED",
        targetType: "showcase",
        targetId: item._id,
        message: "Showcase approved.",
        data: { itemId: String(item._id), startsAt, endsAt, actorRole: "admin" },
        isPersistent: true,
        dedupeKey: `user:${item.creatorId}:showcase:${item._id}:approved`,
      });
    } catch (e) {
      if (e?.code !== 11000) console.error("notify vetrina approved error:", e);
    }

    await logAdminShowcaseDecision(req, item._id, item.creatorId, "approve", null);

    return res.status(200).json({ status: "success" });
  } catch (err) {
    console.error("admin showcase approve error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * PATCH /api/admin/showcase/:id/reject
 * - status=rejected
 * - adminNote OBBLIGATORIA min 10 chars
 * - if paid+held => release tokens (tokenHeld--) + ledger showcase_release
 * - notify: "Showcase rejected: <adminNote>"
 */
router.patch("/showcase/:id/reject", auth, adminGuard, async (req, res) => {
  try {
    const adminId = req.user?._id;
    const itemId = req.params.id;

    const note = String(req.body?.adminNote || "").trim();
    if (!note || note.length < 10) {
      return res.status(400).json({
        status: "error",
        message: "adminNote is required (min 10 chars).",
      });
    }

    const item = await ShowcaseItem.findById(itemId).select(
      "creatorId title billingType paidTokens holdTokens holdStatus opId reviewStatus"
    );
    if (!item) return res.status(404).json({ status: "error", message: "Showcase item not found" });

    if (item.reviewStatus !== "pending") {
      return res.status(409).json({ status: "error", message: "Showcase item is not pending" });
    }

    const now = new Date();

    // release hold if needed
    if (item.billingType === "paid") {
      const rel = Number(item.holdTokens || item.paidTokens || 0);

      if (rel > 0 && item.holdStatus === "held") {
        // recupera la tx di hold per sapere da quali bucket erano stati presi i token
        const holdTx = await TokenTransaction.findOne({
          opId: opIdFor(item),
          kind: "showcase_hold",
          direction: "debit",
          fromUserId: item.creatorId,
        }).lean();

        const movedFromPurchased = Number(holdTx?.metadata?.movedFromPurchased || 0);
        const movedFromEarnings = Number(holdTx?.metadata?.movedFromEarnings || 0);
        const movedFromRedeemable = Number(holdTx?.metadata?.movedFromRedeemable || 0);

        const totalMoved =
          movedFromPurchased + movedFromEarnings + movedFromRedeemable;

        if (totalMoved !== rel) {
          return res.status(409).json({
            status: "error",
            message: "Cannot release Showcase hold: inconsistent hold metadata.",
          });
        }

        const u = await User.findOneAndUpdate(
          {
            _id: item.creatorId,
            tokenHeld: { $gte: rel },
          },
          {
            $inc: {
              tokenHeld: -rel,
              tokenPurchased: movedFromPurchased,
              tokenEarnings: movedFromEarnings,
              tokenRedeemable: movedFromRedeemable,
            },
          },
          { new: true }
        ).select("_id tokenHeld tokenPurchased tokenEarnings tokenRedeemable");

        if (!u) {
          return res.status(409).json({
            status: "error",
            message: "Cannot release held tokens (invalid held state).",
          });
        }

        // ledger release (credit)
        try {
          await TokenTransaction.create({
            opId: opIdFor(item),
            groupId: groupIdFor(item._id),
            fromUserId: item.creatorId,
            toUserId: null,
            kind: "showcase_release",
            direction: "credit",
            context: "showcase",
            contextId: String(item._id),
            amountTokens: rel,
            amountEuro: 0,
            metadata: {
              reason: "showcase_release",
              itemId: String(item._id),
              restoredToPurchased: movedFromPurchased,
              restoredToEarnings: movedFromEarnings,
              restoredToRedeemable: movedFromRedeemable,
            },
          });
        } catch (e) {
          console.error("showcase_release tx error:", e);
        }

        item.holdStatus = "released";
        item.holdTokens = 0;
      }
    }

    item.reviewStatus = "rejected";
    item.reviewedBy = adminId;
    item.reviewedAt = now;
    item.reviewNote = note;

    // non attiviamo finestra
    item.startsAt = null;
    item.endsAt = null;

    await item.save();

    // Notify user (con motivo)
    try {
      await Notification.create({
        userId: item.creatorId,
        actorId: adminId,
        type: "VETRINA_REJECTED",
        targetType: "showcase",
        targetId: item._id,
        message: `Showcase rejected: ${note}`,
        data: { itemId: String(item._id), actorRole: "admin" },
        isPersistent: true,
        dedupeKey: `user:${item.creatorId}:showcase:${item._id}:rejected`,
      });
    } catch (e) {
      if (e?.code !== 11000) console.error("notify vetrina rejected error:", e);
    }

    await logAdminShowcaseDecision(req, item._id, item.creatorId, "reject", note);

    return res.status(200).json({ status: "success" });
  } catch (err) {
    console.error("admin showcase reject error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;