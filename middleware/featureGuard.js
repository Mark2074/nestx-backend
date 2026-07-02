// middleware/featureGuard.js
const { areTokensEnabled, isLiveEnabled } = require("../config/features");

/**
 * featureGuard("tokens"|"live", options?)
 * - If feature is disabled -> 403
 * - options.allowAdmin: allow admin to bypass (useful for internal tests)
 */
module.exports = function featureGuard(featureName, options = {}) {
  const allowAdmin = !!options.allowAdmin;

  return function (req, res, next) {
    try {
      // Optional admin bypass
      const isAdmin =
        String(req.user?.accountType || "").toLowerCase() === "admin";

      if (allowAdmin && isAdmin) return next();

      const enabled =
        featureName === "tokens"
          ? areTokensEnabled()
          : featureName === "live"
          ? isLiveEnabled()
          : false;

      if (!enabled) {
        return res.status(403).json({
          status: "error",
          message: "Feature not available yet",
          code: "FEATURE_DISABLED",
          feature: featureName,
        });
      }

      return next();
    } catch (err) {
      return res.status(500).json({
        status: "error",
        message: "Internal error",
      });
    }
  };
};
