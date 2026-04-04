// middleware/featureGuard.js

function parseBool(v) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

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

      const economyEnabled = parseBool(process.env.ECONOMY_ENABLED);

      // master switch: se ECONOMY_ENABLED=false, tokens deve essere OFF a prescindere
      const tokensEnabled = economyEnabled && parseBool(process.env.TOKENS_ENABLED ?? "true");

      const enabled =
        featureName === "tokens"
          ? tokensEnabled
          : featureName === "live"
          ? parseBool(process.env.LIVE_ENABLED)
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
