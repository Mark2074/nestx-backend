const express = require("express");
const router = express.Router();

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");

const AdminAuditLog = require("../models/AdminAuditLog");

router.get("/security-log", auth, adminGuard, async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(200, Math.max(1, Math.floor(limitRaw)))
      : 100;

    const actionType = (req.query.actionType || "").toString().trim();
    const targetId = (req.query.targetId || "").toString().trim();
    const targetType = (req.query.targetType || "").toString().trim();

    const filter = {};
    if (actionType) filter.actionType = actionType;
    if (targetType) filter.targetType = targetType;
    if (targetId) filter.targetId = targetId;

    const logs = await AdminAuditLog.find(filter)
      .populate("adminId", "displayName")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const data = logs.map((l) => ({
      _id: String(l._id),
      createdAt: l.createdAt,
      actionType: l.actionType,
      targetType: l.targetType,
      targetId: l.targetId ?? null,
      admin: l.adminId
        ? { _id: String(l.adminId._id || l.adminId), displayName: l.adminId.displayName || "Admin" }
        : null,
      meta: l.meta || {},
    }));

    return res.json({ status: "success", data });
  } catch (err) {
    console.error("ADMIN /security-log error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;