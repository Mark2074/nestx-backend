// routes/adminPayoutRoutes.js
const express = require("express");
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const User = require("../models/user");
const PayoutRequest = require("../models/payoutRequest");
const TokenTransaction = require("../models/tokenTransaction");

const router = express.Router();

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function normalizeStatus(s) {
  const v = String(s || "pending").toLowerCase().trim();
  const allowed = new Set(["pending", "approved", "rejected", "paid"]);
  return allowed.has(v) ? v : null;
}

// ======================================================
// GET /api/admin/payout/requests?status=pending|approved|rejected|paid
// default: pending
router.get("/requests", auth, adminGuard, async (req, res) => {
  try {
    const status = normalizeStatus(req.query.status) || "pending";

    const list = await PayoutRequest.find({ status })
      .sort({ requestedAt: -1 })
      .limit(50)
      .lean();

    return res.json({ status: "ok", count: list.length, data: list });
  } catch (e) {
    console.error("admin payout list error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// (facoltativo) compat: vecchia rotta /pending -> usa /requests
router.get("/pending", auth, adminGuard, async (req, res) => {
  req.query.status = "pending";
  return router.handle(req, res);
});

// ======================================================
// PATCH /api/admin/payout/requests/:id/approve
// Body: { note?: string }
router.patch("/requests/:id/approve", auth, adminGuard, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ status: "error", message: "Invalid payoutId" });
    }

    const adminNote = (req.body?.note || "").toString().trim() || null;
    const now = new Date();

    const updated = await PayoutRequest.findOneAndUpdate(
      { _id: id, status: "pending" },
      {
        $set: {
          status: "approved",
          reviewedByAdminId: req.user._id,
          adminNote: adminNote,
          approvedAt: now,
        },
        $push: {
          audit: {
            action: "approve",
            byAdminId: req.user._id,
            at: now,
            note: adminNote,
            providerTransferId: null,
          },
        },
      },
      { new: true }
    );

    if (!updated) {
      const exists = await PayoutRequest.findById(id).select("status").lean();
      if (!exists) return res.status(404).json({ status: "error", message: "PayoutRequest not found" });
      return res.status(409).json({ status: "error", message: "PayoutRequest not in pending status" });
    }

    return res.json({ status: "ok", data: updated });
  } catch (e) {
    console.error("admin payout approve error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// ======================================================
// PATCH /api/admin/payout/requests/:id/reject
// Body: { note: string }  (OBBLIGATORIA)
router.patch("/requests/:id/reject", auth, adminGuard, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ status: "error", message: "Invalid payoutId" });
    }

    const noteRaw = (req.body?.note || "").toString().trim();
    if (!noteRaw) {
      return res.status(400).json({ status: "error", message: "adminNote is required" });
    }

    const now = new Date();

    const updated = await PayoutRequest.findOneAndUpdate(
      { _id: id, status: "pending" },
      {
        $set: {
          status: "rejected",
          reviewedByAdminId: req.user._id,
          adminNote: noteRaw,
          rejectedAt: now,
        },
        $push: {
          audit: {
            action: "reject",
            byAdminId: req.user._id,
            at: now,
            note: noteRaw,
            providerTransferId: null,
          },
        },
      },
      { new: true }
    );

    if (!updated) {
      const exists = await PayoutRequest.findById(id).select("status").lean();
      if (!exists) return res.status(404).json({ status: "error", message: "PayoutRequest not found" });
      return res.status(409).json({ status: "error", message: "PayoutRequest not in pending status" });
    }

    return res.json({ status: "ok", data: updated });
  } catch (e) {
    console.error("admin payout reject error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// ======================================================
// PATCH /api/admin/payout/requests/:id/mark-paid
// Body: { providerTransferId?: string }
router.patch("/requests/:id/mark-paid", auth, adminGuard, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ status: "error", message: "Invalid payoutId" });
    }

    const providerTransferId = (req.body?.providerTransferId || "").toString().trim() || null;
    const now = new Date();

    let outDoc = null;

    await session.withTransaction(async () => {
      // 1) lock-ish read (within session) + status checks
      const doc = await PayoutRequest.findById(id).session(session);
      if (!doc) {
        const err = new Error("NOT_FOUND");
        err.http = 404;
        throw err;
      }

      if (doc.status === "paid") {
        // idempotent: already paid
        outDoc = doc.toObject();
        return;
      }

      if (doc.status !== "approved") {
        const err = new Error("NOT_APPROVED");
        err.http = 409;
        throw err;
      }

      if (doc.provider === "stripe" && !providerTransferId) {
        const err = new Error("TRANSFER_ID_REQUIRED");
        err.http = 400;
        throw err;
      }

      const amount = Number(doc.amountTokens || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        const err = new Error("INVALID_AMOUNT");
        err.http = 409;
        throw err;
      }

      const userId = doc.userId;

      // 2) idempotency guard (ledger)
      const opId = `payout:${doc._id.toString()}`;
      const existingTx = await TokenTransaction.findOne({ opId, kind: "payout" })
        .select("_id")
        .session(session)
        .lean();

      if (existingTx) {
        // Se esiste ledger ma request non è paid -> stato incoerente
        // NON tocchiamo i bucket: fermiamo tutto.
        const err = new Error("LEDGER_ALREADY_EXISTS");
        err.http = 409;
        throw err;
      }

      // 3) atomic bucket decrement with balance guards
      const u = await User.findOneAndUpdate(
        {
          _id: userId,
          tokenRedeemable: { $gte: amount },
          tokenBalance: { $gte: amount },
        },
        {
          $inc: {
            tokenRedeemable: -amount,
            tokenBalance: -amount,
          },
        },
        { new: true, session }
      ).select("_id tokenBalance tokenRedeemable");

      if (!u) {
        const err = new Error("INSUFFICIENT_BUCKETS");
        err.http = 409;
        throw err;
      }

      // 4) ledger payout (single debit row)
      await TokenTransaction.create(
        [
          {
            opId,
            groupId: opId,
            fromUserId: userId,
            toUserId: null,
            kind: "payout",
            direction: "debit",
            context: "system",
            contextId: doc._id,
            amountTokens: amount,
            amountEuro: 0,
            metadata: {
              provider: doc.provider,
              providerTransferId,
              payoutRequestId: doc._id.toString(),
            },
          },
        ],
        { session }
      );

      // 5) mark paid + audit
      doc.status = "paid";
      doc.paidAt = now;
      doc.providerTransferId = providerTransferId;

      doc.audit = Array.isArray(doc.audit) ? doc.audit : [];
      doc.audit.push({
        action: "mark_paid",
        byAdminId: req.user._id,
        at: now,
        note: null,
        providerTransferId,
      });

      await doc.save({ session });

      outDoc = doc.toObject();
    });

    return res.json({ status: "ok", data: outDoc });
  } catch (e) {
    const http = e?.http;

    if (http === 404) return res.status(404).json({ status: "error", message: "PayoutRequest not found" });
    if (http === 400)
      return res.status(400).json({ status: "error", message: "providerTransferId required when provider is stripe" });

    if (http === 409) {
      const msg =
        e.message === "NOT_APPROVED"
          ? "PayoutRequest not in approved status"
          : e.message === "INSUFFICIENT_BUCKETS"
          ? "Insufficient token buckets to mark paid"
          : e.message === "LEDGER_ALREADY_EXISTS"
          ? "Payout already processed (ledger exists)"
          : "Conflict";

      return res.status(409).json({ status: "error", message: msg });
    }

    console.error("admin payout mark-paid error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  } finally {
    session.endSession();
  }
});

module.exports = router;