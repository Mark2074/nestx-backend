// routes/stripeWebhookRoutes.js
const express = require("express");
const router = express.Router();

const User = require("../models/user");

// Se usi Stripe davvero:
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe richiede RAW body per verificare signature
router.post("/stripe", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    console.log("✅ Webhook HIT /stripe");
    console.log("Headers stripe-signature present?", !!req.headers["stripe-signature"]);
    console.log("Raw body length:", req.body?.length);

    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error("Stripe webhook signature FAILED:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log("✅ Stripe event verified:", event.type);

    try {
      // Evento tipico: account.updated
      if (event.type === "account.updated" || event.type === "connect.account.updated") {
        const account = event.data.object;

        // Qui devi sapere come colleghi account Stripe -> user
        // Soluzione comune:
        // user.payoutAccountId = account.id
        const stripeAccountId = account.id;

        const payoutEnabled = !!account.payouts_enabled; // boolean vero

        // Aggiorna utente
        const user = await User.findOne({ payoutAccountId: stripeAccountId });
        if (user) {
          user.payoutEnabled = payoutEnabled;
          user.payoutProvider = "stripe";
          user.payoutStatus = payoutEnabled ? "approved" : "pending";

          // salva raw meta utile (NON stringa)
          user.payoutMeta = {
            payouts_enabled: account.payouts_enabled,
            charges_enabled: account.charges_enabled,
            details_submitted: account.details_submitted,
            requirements: account.requirements || null,
            updatedAt: new Date().toISOString(),
          };

          await user.save();
        }
      }

      return res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook handler error:", err);
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

module.exports = router;
