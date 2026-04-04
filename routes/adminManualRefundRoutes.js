const express = require("express");
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");
const RefundRequest = require("../models/RefundRequest");
const RefundLog = require("../models/RefundLog");
const Notification = require("../models/notification");

const router = express.Router();

// POST /api/admin/manual-refunds/:id/approve
router.post("/manual-refunds/:id/approve", auth, adminGuard, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;
    const adminNote = String(req.body?.adminNote || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: "error", message: "Invalid request id" });
    }

    let out = null;

    await session.withTransaction(async () => {
      const rr = await RefundRequest.findById(id).session(session);
      if (!rr) {
        const err = new Error("RefundRequest not found");
        err.statusCode = 404;
        throw err;
      }

      // idempotenza
      if (rr.status === "refunded") {
        out = rr;
        return;
      }

      if (rr.status !== "pending" && rr.status !== "approved") {
        const err = new Error(`RefundRequest not actionable (status=${rr.status})`);
        err.statusCode = 400;
        throw err;
      }

      const amountTokens = Number(rr.amountTokens || 0);
      if (!Number.isFinite(amountTokens) || amountTokens <= 0) {
        const err = new Error("Invalid amountTokens on request");
        err.statusCode = 400;
        throw err;
      }

      // 1) credit token all'utente
      const updatedUser = await User.findByIdAndUpdate(
        rr.requesterUserId,
        { $inc: { tokenBalance: amountTokens } },
        { new: true, session }
      ).select("_id tokenBalance");

      if (!updatedUser) {
        const err = new Error("Requester user not found");
        err.statusCode = 404;
        throw err;
      }

      // 2) log contabile refund
      const log = await RefundLog.create(
        [
          {
            type: "manual_refund",
            userId: rr.requesterUserId,
            amountTokens,
            currency: "token",
            reasonCode: "MANUAL_APPROVED",
            referenceType: rr.referenceType,
            referenceId: rr.referenceId,
            createdByAdminId: req.user?._id || null,
            resolved: true,
          },
        ],
        { session, ordered: true }
      );

      const refundLogId = log?.[0]?._id || null;

      // 3) token transaction (riuso kind esistente, così non rompi enum)
      await TokenTransaction.create(
        [
          {
            fromUserId: null,
            toUserId: rr.requesterUserId,
            kind: "ticket_refund",
            direction: "credit",
            context: "system",
            amountTokens,
            amountEuro: 0,
            metadata: {
              refundType: "manual",
              refundRequestId: rr._id.toString(),
              refundLogId: refundLogId ? refundLogId.toString() : null,
              adminNote: adminNote || null,
              referenceType: rr.referenceType,
              referenceId: rr.referenceId,
            },
          },
        ],
        { session, ordered: true }
      );

      // 4) chiudi request
      rr.status = "refunded";
      rr.adminNote = adminNote || rr.adminNote || null;
      rr.decidedAt = rr.decidedAt || new Date();
      rr.decidedByAdminId = rr.decidedByAdminId || (req.user?._id || null);
      rr.refundedAt = new Date();
      rr.refundLogId = refundLogId;

      await rr.save({ session });

      // 5) notification (user)
      await Notification.create(
        [
          {
            userId: rr.requesterUserId,
            actorId: req.user?._id || null,
            type: "MANUAL_REFUND_APPROVED",
            targetType: "system",
            targetId: rr._id,
            message: `Refund approved. ${amountTokens} tokens have been credited to your balance.`,
            data: {
              requestId: rr._id.toString(),
              amountTokens,
              referenceType: rr.referenceType || null,
              referenceId: rr.referenceId || null,
              adminNote: adminNote || null,
            },
            isPersistent: true,
            dedupeKey: `manual_refund:${rr._id.toString()}:approved`,
          },
        ],
        { session, ordered: true }
      );

      out = rr;
    });

    return res.json({ status: "ok", data: { request: out } });
  } catch (e) {
    const code = e?.statusCode || 500;
    console.error("approve manual refund error:", e);
    return res.status(code).json({ status: "error", message: e?.message || "Internal error" });
  } finally {
    session.endSession().catch(() => {});
  }
});

// POST /api/admin/manual-refunds/:id/reject
router.post("/manual-refunds/:id/reject", auth, adminGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const adminNote = String(req.body?.adminNote || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: "error", message: "Invalid request id" });
    }

    if (!adminNote) {
      return res.status(400).json({ status: "error", message: "adminNote is required for reject" });
    }

    const rr = await RefundRequest.findById(id);
    if (!rr) {
      return res.status(404).json({ status: "error", message: "RefundRequest not found" });
    }

    if (rr.status !== "pending") {
      return res.status(400).json({ status: "error", message: `Cannot reject (status=${rr.status})` });
    }

    rr.status = "rejected";
    rr.adminNote = adminNote;
    rr.decidedAt = new Date();
    rr.decidedByAdminId = req.user?._id || null;

    await rr.save();

    // notification (user)
    await Notification.create({
      userId: rr.requesterUserId,
      actorId: req.user?._id || null,
      type: "MANUAL_REFUND_REJECTED",
      targetType: "system",
      targetId: rr._id,
      message: "Refund rejected. Please read the admin note for details.",
      data: {
        requestId: rr._id.toString(),
        amountTokens: Number(rr.amountTokens || 0),
        referenceType: rr.referenceType || null,
        referenceId: rr.referenceId || null,
        adminNote,
      },
      isPersistent: true,
      dedupeKey: `manual_refund:${rr._id.toString()}:rejected`,
    });

    return res.json({ status: "ok", data: { request: rr } });
  } catch (e) {
    console.error("reject manual refund error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
