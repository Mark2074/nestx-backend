// routes/adminEconomyRefundRoutes.js
const express = require("express");
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");
const RefundRequest = require("../models/RefundRequest");
const RefundLog = require("../models/RefundLog");

const router = express.Router();

// POST /api/admin/economy/manual-refunds/:id/approve
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
      if (!Number.isFinite(amountTokens) || !Number.isInteger(amountTokens) || amountTokens <= 0) {
        const err = new Error("Invalid amountTokens");
        err.statusCode = 400;
        throw err;
      }

      // 1) credit token
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

      // 2) refund log (manual)
      const logs = await RefundLog.create(
        [{
          type: "manual_refund",
          userId: rr.requesterUserId,
          amountTokens,
          currency: "token",
          reasonCode: "MANUAL_APPROVED",
          referenceType: rr.referenceType,
          referenceId: rr.referenceId,
          createdByAdminId: req.user?._id || null,
          resolved: true,
        }],
        { session, ordered: true }
      );

      const refundLogId = logs?.[0]?._id || null;

      // 3) ledger
      await TokenTransaction.create(
        [{
            opId: `manual_refund:${rr._id.toString()}`,
            groupId: `manual_refund:${rr._id.toString()}`,
          fromUserId: null,
          toUserId: rr.requesterUserId,
          kind: "ticket_refund",      // riuso kind già presente per evitare rotture enum
          direction: "credit",
          context: "system",
          contextId: rr._id.toString(),
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
        }],
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

      out = rr;
    });

    return res.json({ status: "ok", data: { request: out } });
  } catch (e) {
    const code = e?.statusCode || 500;
    console.error("manual refund approve error:", e);
    return res.status(code).json({ status: "error", message: e?.message || "Internal error" });
  } finally {
    session.endSession().catch(() => {});
  }
});

// POST /api/admin/economy/manual-refunds/:id/reject
router.post("/manual-refunds/:id/reject", auth, adminGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const adminNote = String(req.body?.adminNote || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ status: "error", message: "Invalid request id" });
    }
    if (!adminNote) {
      return res.status(400).json({ status: "error", message: "adminNote is required" });
    }

    const rr = await RefundRequest.findById(id);
    if (!rr) return res.status(404).json({ status: "error", message: "RefundRequest not found" });
    if (rr.status !== "pending") {
      return res.status(400).json({ status: "error", message: `Cannot reject (status=${rr.status})` });
    }

    rr.status = "rejected";
    rr.adminNote = adminNote;
    rr.decidedAt = new Date();
    rr.decidedByAdminId = req.user?._id || null;
    await rr.save();

    return res.json({ status: "ok", data: { request: rr } });
  } catch (e) {
    console.error("manual refund reject error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
