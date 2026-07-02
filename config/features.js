function parseBool(v) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

function isEconomyEnabled() {
  return parseBool(process.env.ECONOMY_ENABLED);
}

function isLiveEnabled() {
  return parseBool(process.env.LIVE_ENABLED);
}

function areTokensEnabled() {
  return isEconomyEnabled() && parseBool(process.env.TOKENS_ENABLED ?? "true");
}

module.exports = {
  areTokensEnabled,
  isEconomyEnabled,
  isLiveEnabled,
  parseBool,
};
