const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const BugReport = require("../models/bugReport");

// POST /api/bugreports
router.post("/", auth, async (req, res) => {
  try {
    const { category, text, steps, screenshotUrl, route, userAgent } = req.body;

    if (!category || !text) {
      return res.status(400).json({
        status: "error",
        message: "Category and text are required",
      });
    }

    const report = await BugReport.create({
      userId: req.user._id,
      category,
      text,
      steps: steps || null,
      screenshotUrl: screenshotUrl || null,
      route: route || null,
      userAgent: userAgent || req.headers["user-agent"] || null,
    });

    return res.json({
      status: "success",
      data: { id: report._id },
    });
  } catch (e) {
    console.error("bug report create error:", e);
    return res.status(500).json({
      status: "error",
      message: "Server error",
    });
  }
});

module.exports = router;