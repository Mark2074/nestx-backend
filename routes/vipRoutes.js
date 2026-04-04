const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const featureGuard = require("../middleware/featureGuard");

const {
  VIP_PRICE,
  VIP_DAYS,
  maybeRenewVip,
  buyVip,
  cancelVipAutoRenew,
} = require("../services/vipService");

function isVipActiveFromUser(u) {
  const now = new Date();
  return u?.isVip === true && u?.vipExpiresAt && new Date(u.vipExpiresAt) > now;
}

// GET /api/vip/status
router.get("/status", auth, async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "User not authenticated" });
    }

    // lazy renew (SERVER TIME)
    const r = await maybeRenewVip(userId);

    // Rileggi user fresco se serve
    const u = r?.user;
    return res.json({
      isVipActive: isVipActiveFromUser(u),
      vipExpiresAt: u?.vipExpiresAt ?? null,
      vipAutoRenew: !!u?.vipAutoRenew,
      priceTokens: VIP_PRICE,
      days: VIP_DAYS,
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/vip/buy
router.post("/buy", auth, featureGuard("tokens"), async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "User not authenticated" });
    }

    const r = await buyVip(userId);
    const u = r?.user;

    return res.json({
      status: "ok",
      isVipActive: isVipActiveFromUser(u),
      vipExpiresAt: u?.vipExpiresAt ?? null,
      vipAutoRenew: !!u?.vipAutoRenew,
      priceTokens: VIP_PRICE,
      days: VIP_DAYS,
    });
  } catch (err) {
    if (err?.code === "INSUFFICIENT_TOKENS" || String(err?.message || "") === "INSUFFICIENT_TOKENS") {
      return res.status(400).json({
        status: "error",
        message: "Insufficient tokens",
        code: "INSUFFICIENT_TOKENS",
      });
    }

    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/vip/cancel
router.post("/cancel", auth, async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "User not authenticated" });
    }

    const u = await cancelVipAutoRenew(userId);

    return res.json({
      status: "ok",
      isVipActive: isVipActiveFromUser(u),
      vipExpiresAt: u?.vipExpiresAt ?? null,
      vipAutoRenew: !!u?.vipAutoRenew,
      priceTokens: VIP_PRICE,
      days: VIP_DAYS,
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;