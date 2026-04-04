const express = require("express");
const router = express.Router();

const PlatformUpdate = require("../models/platformUpdate");

/**
 * GET /api/updates/serve
 * ritorna 1 item attivo (rotazione)
 */
router.get("/serve", async (req, res) => {
  try {
    // rotazione random tra attive
    const pick = await PlatformUpdate.aggregate([
      { $match: { isActive: true } },
      { $sample: { size: 1 } },
      { $project: { _id: 1, text: 1, isActive: 1, createdAt: 1 } },
    ]);

    const one = pick?.[0] || null;

    return res.status(200).json({
      status: "success",
      data: one
        ? { id: one._id, text: one.text, createdAt: one.createdAt }
        : null,
    });
  } catch (err) {
    console.error("updates serve error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;