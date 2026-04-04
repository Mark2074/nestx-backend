// routes/stripeConnectRoutes.js
const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const User = require("../models/user");

const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * POST /api/stripe/connect/onboard
 * Avvia onboarding Stripe Connect (crea account se manca + ritorna account_link url)
 *
 * Body (opzionale):
 * - refreshUrl: string (fallback: http://localhost:3000/stripe/refresh)
 * - returnUrl:  string (fallback: http://localhost:3000/stripe/return)
 */
router.post("/connect/onboard", auth, async (req, res) => {
  try {
    const userId = req.user && req.user._id ? req.user._id : null;
    if (!userId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    // Blocco lato piattaforma (kill switch)
    // Se vuoi vietare persino l'onboarding a utenti bloccati:
    if (user.creatorEnabled === false) {
      return res.status(403).json({
        status: "error",
        message: "Creator onboarding disabled by platform",
      });
    }

    // 1) Crea Connected Account se non esiste
    let accountId = user.payoutAccountId;

    if (!accountId) {
      // NB: accountType "express" è la scelta più comune per marketplace.
      // "standard" delega più cose a Stripe ma spesso è più limitante lato controllo UX.
      const account = await stripe.accounts.create({
        type: "express",
        // email: user.email, // se vuoi (ma tu l'hai tolta dalle response pubbliche; nel DB ce l'hai)
        metadata: {
          nestxUserId: String(user._id),
        },
      });

      accountId = account.id;

      user.payoutProvider = "stripe";
      user.payoutAccountId = accountId;
      user.payoutEnabled = false;
      user.payoutStatus = "pending";
      user.creatorEligible = false; // diventa true SOLO da webhook account.updated
      if (typeof user.creatorEnabled !== "boolean") user.creatorEnabled = true;

      await user.save();
    }

    // 2) Crea Account Link (onboarding URL)
    const refreshUrl =
      (req.body && req.body.refreshUrl) || "http://localhost:3000/stripe/refresh";
    const returnUrl =
      (req.body && req.body.returnUrl) || "http://localhost:3000/stripe/return";

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    return res.json({
      status: "ok",
      payoutProvider: user.payoutProvider || "stripe",
      payoutAccountId: accountId,
      url: accountLink.url,
    });
  } catch (err) {
    console.error("Stripe Connect onboard error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

/**
 * GET /api/stripe/connect/status
 * Ritorna lo stato creator lato NestX + Stripe-link
 */
router.get("/connect/status", auth, async (req, res) => {
  try {
    const userId = req.user && req.user._id ? req.user._id : null;
    if (!userId) return res.status(401).json({ status: "error", message: "Unauthorized" });

    const user = await User.findById(userId).select(
      "payoutProvider payoutAccountId payoutEnabled payoutStatus creatorEligible creatorEnabled creatorDisabledReason creatorDisabledAt"
    );

    if (!user) return res.status(404).json({ status: "error", message: "User not found" });

    return res.json({ status: "ok", data: user });
  } catch (err) {
    console.error("Stripe Connect status error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
