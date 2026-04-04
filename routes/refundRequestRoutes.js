const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/authMiddleware");

const RefundRequest = require("../models/RefundRequest");

const router = express.Router();

// POST /api/refunds/request
router.post("/request", auth, async (req, res) => {
  try {
    const { amountTokens, reasonText, referenceType, referenceId, attachments } = req.body || {};

    const amt = Number(amountTokens);
    if (!Number.isFinite(amt) || !Number.isInteger(amt) || amt <= 0) {
      return res.status(400).json({ status: "error", message: "amountTokens must be an integer > 0" });
    }

    const reason = String(reasonText || "").trim();
    if (reason.length < 10) {
      return res.status(400).json({ status: "error", message: "reasonText must be at least 10 characters" });
    }

    const refType = String(referenceType || "").trim();
    const allowed = ["event", "ticket", "payment", "post", "other"];
    if (!allowed.includes(refType)) {
      return res.status(400).json({ status: "error", message: "Invalid referenceType" });
    }

    const refId = String(referenceId || "").trim();
    if (!refId) {
      return res.status(400).json({ status: "error", message: "referenceId is required" });
    }

    const att = Array.isArray(attachments) ? attachments.filter(x => typeof x === "string" && x.trim()) : [];

    const doc = await RefundRequest.create({
      requesterUserId: req.user._id,
      amountTokens: amt,
      reasonText: reason,
      referenceType: refType,
      referenceId: refId,
      attachments: att,
      status: "pending",
    });

    return res.status(201).json({ status: "ok", data: { request: doc } });
  } catch (e) {
    console.error("POST /refunds/request error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
