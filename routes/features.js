const express = require("express");
const { isEconomyEnabled, isLiveEnabled } = require("../config/features");

const router = express.Router();

router.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({
    liveEnabled: isLiveEnabled(),
    economyEnabled: isEconomyEnabled(),
  });
});

module.exports = router;
