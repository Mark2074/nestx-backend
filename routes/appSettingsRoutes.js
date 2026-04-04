const express = require("express");
const router = express.Router();
const User = require("../models/user");
const auth = require("../middleware/authMiddleware"); // adattalo al tuo path reale

const DEFAULTS = {
  theme: "system",
  uiLanguage: "it",
  timeFormat: "24h",
  contentContext: "standard",
};

router.get("/", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("appSettings");
    const appSettings = { ...DEFAULTS, ...(user?.appSettings?.toObject?.() ?? user?.appSettings ?? {}) };
    return res.json({ appSettings });
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

router.put("/", auth, async (req, res) => {
  try {
    const { theme, uiLanguage, timeFormat, contentContext } = req.body || {};

    // Update solo dei campi consentiti (hard safe)
    const update = {};
    if (theme !== undefined) update["appSettings.theme"] = theme;
    if (uiLanguage !== undefined) update["appSettings.uiLanguage"] = uiLanguage;
    if (timeFormat !== undefined) update["appSettings.timeFormat"] = timeFormat;
    if (contentContext !== undefined) update["appSettings.contentContext"] = contentContext;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: update },
      { new: true, runValidators: true, select: "appSettings" }
    );

    const appSettings = { ...DEFAULTS, ...(user?.appSettings?.toObject?.() ?? user?.appSettings ?? {}) };
    return res.json({ appSettings });
  } catch (e) {
    // validator enum -> 400
    return res.status(400).json({ error: "INVALID_APP_SETTINGS" });
  }
});

module.exports = router;
