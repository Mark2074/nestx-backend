function detectContentSafety(text = "", mode = "public") {
  const t = String(text || "").toLowerCase();

  // =========================
  // 1) HARD BLOCK LINK
  // =========================
  const urlRegex = /\bhttps?:\/\/\S+/i;
  const wwwRegex = /\bwww\.\S+/i;
  const domainRegex = /\b[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?/i;

  if (urlRegex.test(t) || wwwRegex.test(t) || domainRegex.test(t)) {
    return {
      blocked: true,
      code: "LINK_NOT_ALLOWED",
      message: "External links are not allowed.",
    };
  }

  // =========================
  // 2) EMAIL (consentita nei DM)
  // =========================
  const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const hasEmail = emailRegex.test(text);

  // =========================
  // 3) TELEFONO (consentito nei DM)
  // =========================
  const phoneRegex = /\b(\+?\d{1,3}[\s.-]?)?\d{6,14}\b/;
  const hasPhone = phoneRegex.test(text);

  // =========================
  // 4) KEYWORDS FUNNEL (block sempre)
  // =========================
  const funnelKeywords = [
    "telegram",
    "discord",
    "onlyfans",
    "snapchat",
    "skype",
    "kick",
    "twitch",
    "scrivimi su",
    "contattami su",
    "join",
    "gruppo",
    "canale",
    "dm me",
    "link in bio",
  ];

  for (const k of funnelKeywords) {
    if (t.includes(k)) {
      return {
        blocked: true,
        code: "FUNNEL_NOT_ALLOWED",
        message: "External contact invitations are not allowed.",
      };
    }
  }

  // =========================
  // 5) MODALITÀ
  // =========================

  // PUBLIC (post, commenti, chat pubblica)
  if (mode === "public") {
    if (hasEmail || hasPhone) {
      return {
        blocked: true,
        code: "CONTACT_NOT_ALLOWED",
        message: "Sharing contact information is not allowed.",
      };
    }
  }

  // DM PRIVATI
  if (mode === "dm") {
    // consentiamo email e telefono
    // ma NON link (già bloccati sopra)
    return { blocked: false };
  }

  return { blocked: false };
}

module.exports = { detectContentSafety };