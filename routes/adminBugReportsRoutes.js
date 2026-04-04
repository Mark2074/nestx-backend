const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");
const BugReport = require("../models/bugReport");

// GET /api/admin/bugreports
router.get("/bugreports", auth, adminGuard, async (req, res) => {
  try {
    const { status = "open", limit = 50, skip = 0, sort = "new" } = req.query;

    const filter =
      status === "all"
        ? {}
        : { status: status === "closed" ? "closed" : "open" };

    const sortObj = sort === "old" ? { createdAt: 1 } : { createdAt: -1 };

    const items = await BugReport.find(filter)
      .sort(sortObj)
      .skip(Number(skip))
      .limit(Math.min(200, Number(limit)))
      .populate("userId", "displayName username");

    return res.json({
      status: "success",
      data: items,
    });
  } catch (e) {
    console.error("admin bugreports list error:", e);
    return res.status(500).json({
      status: "error",
      message: "Server error",
    });
  }
});

// PATCH /api/admin/bugreports/:id
router.patch("/bugreports/:id", auth, adminGuard, async (req, res) => {
  try {
    const { status } = req.body;

    if (!["open", "closed"].includes(status)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid status",
      });
    }

    const updated = await BugReport.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    return res.json({
      status: "success",
      data: updated,
    });
  } catch (e) {
    console.error("admin bugreport patch error:", e);
    return res.status(500).json({
      status: "error",
      message: "Server error",
    });
  }
});

module.exports = router;