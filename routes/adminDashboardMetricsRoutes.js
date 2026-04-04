const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");

function startOfMonth(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

// GET /api/admin/dashboard/metrics
router.get("/dashboard/metrics", auth, adminGuard, async (req, res) => {
  try {
    const vipUsersActive = await User.countDocuments({ isVip: true });

    const sums = await User.aggregate([
      {
        $group: {
          _id: null,
          tokensTotalBalance: { $sum: { $ifNull: ["$tokenBalance", 0] } },
          tokensRedeemable: { $sum: { $ifNull: ["$tokenRedeemable", 0] } },
        },
      },
    ]);

    const tokensTotalBalance = Number(sums?.[0]?.tokensTotalBalance ?? 0);
    const tokensRedeemable = Number(sums?.[0]?.tokensRedeemable ?? 0);

    const som = startOfMonth(new Date());

    const revenueAgg = await TokenTransaction.aggregate([
      {
        $match: {
          createdAt: { $gte: som },
          direction: "debit",
          kind: { $in: ["vip_purchase", "adv_purchase", "showcase_charge"] },
        },
      },
      {
        $group: {
          _id: "$kind",
          total: { $sum: { $ifNull: ["$amountTokens", 0] } },
        },
      },
    ]);

    const totalsByKind = {
      vip_purchase: 0,
      adv_purchase: 0,
      showcase_charge: 0,
    };

    for (const row of revenueAgg) {
      const k = String(row?._id || "");
      const v = Number(row?.total || 0);
      if (k in totalsByKind) totalsByKind[k] = v;
    }

    const vipRevenueTokensCurrentMonth = totalsByKind.vip_purchase;
    const advRevenueTokensCurrentMonth = totalsByKind.adv_purchase;
    const showcaseRevenueTokensCurrentMonth = totalsByKind.showcase_charge;
    const totalRevenueTokensCurrentMonth =
      vipRevenueTokensCurrentMonth +
      advRevenueTokensCurrentMonth +
      showcaseRevenueTokensCurrentMonth;

    return res.json({
      status: "success",
      data: {
        vipUsersActive,
        tokensTotalBalance,
        tokensRedeemable,
        vipRevenueTokensCurrentMonth,
        advRevenueTokensCurrentMonth,
        showcaseRevenueTokensCurrentMonth,
        totalRevenueTokensCurrentMonth,
      },
    });
  } catch (e) {
    console.error("admin dashboard metrics error:", e);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
});

module.exports = router;