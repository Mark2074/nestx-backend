// internalServiceGuard.js

const expected = process.env.INTERNAL_SERVICE_KEY;

// 🚨 FAIL-LOUD ALL'AVVIO IN PRODUZIONE
if (process.env.NODE_ENV === "production" && !expected) {
  throw new Error("FATAL: INTERNAL_SERVICE_KEY is missing in production environment");
}

module.exports = function internalServiceGuard(req, res, next) {
  try {
    const key = req.headers["x-internal-key"];

    if (!key || key !== expected) {
      return res.status(403).json({
        status: "error",
        message: "forbidden",
      });
    }

    next();
  } catch (err) {
    console.error("internalServiceGuard error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal error",
    });
  }
};

