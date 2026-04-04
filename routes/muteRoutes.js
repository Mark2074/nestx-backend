const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const MutedUser = require("../models/MutedUser");
const User = require("../models/user");

const router = express.Router();

router.post("/:targetUserId", authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const { targetUserId } = req.params;

    if (userId === targetUserId) {
      return res.status(400).json({ message: "You can't silence yourself" });
    }

    await MutedUser.findOneAndUpdate(
      { userId, mutedUserId: targetUserId },
      { userId, mutedUserId: targetUserId },
      { upsert: true, new: true }
    );

    res.json({ status: "ok", muted: true });
  } catch (err) {
    res.status(500).json({ message: "Error muting user" });
  }
});

router.delete("/:targetUserId", authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const { targetUserId } = req.params;

    await MutedUser.deleteOne({ userId, mutedUserId: targetUserId });

    res.json({ status: "ok", muted: false });
  } catch (err) {
    res.status(500).json({ message: "Error removing silence" });
  }
});

router.get("/", authMiddleware, async (req, res) => {
  try {
    const rows = await MutedUser.find({ userId: req.user._id })
      .select("mutedUserId createdAt")
      .lean();

    const ids = rows.map((r) => r.mutedUserId).filter(Boolean);

    if (!ids.length) {
      return res.json({ status: "success", data: [] });
    }

    const users = await User.find({ _id: { $in: ids } })
      .select("_id username displayName avatar")
      .lean();

    // Mantieni l'ordine del mute list
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const data = ids
      .map((id) => {
        const u = byId.get(String(id));
        if (!u) return null;
        return {
          id: String(u._id),
          username: u.username || "",
          displayName: u.displayName || "",
          avatar: u.avatar || "",
        };
      })
      .filter(Boolean);

    return res.json({ status: "success", data });
  } catch (err) {
    console.error("Error retrieving muted users list", err);
    return res.status(500).json({ status: "error", message: "Error retrieving muted users list" });
  }
});

router.get("/check/:targetUserId", authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const { targetUserId } = req.params;

    const exists = await MutedUser.findOne({ userId, mutedUserId: targetUserId }).lean();

    return res.json({ status: "success", muted: !!exists });
  } catch (err) {
    console.error("Error checking mute state", err);
    return res.status(500).json({ status: "error", message: "Error checking mute state" });
  }
});

module.exports = router;
