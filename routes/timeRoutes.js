const express = require("express");
const router = express.Router();

// GET /api/time
router.get("/time", (req, res) => {
  return res.json({ serverNow: new Date().toISOString() });
});

module.exports = router;