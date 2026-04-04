// middleware/adminGuard.js
module.exports = function adminGuard(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ status: "error", message: "Not authenticated" });
    }

    // accountType: "base" | "creator" | "admin" (VIP è isVip boolean)
    if (req.user.accountType !== "admin") {
      return res.status(403).json({ status: "error", message: "admin only" });
    }

    next();
  } catch (err) {
    console.error("adminGuard error:", err);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
};

