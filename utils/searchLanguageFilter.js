function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildUserLanguageFilter(language) {
  const normalized = String(language || "").trim().toLowerCase();
  if (!normalized) return null;

  const exactLanguage = new RegExp(`^${escapeRegex(normalized)}$`, "i");
  const additionalLanguage = new RegExp(
    `(?:^|,)\\s*${escapeRegex(normalized)}\\s*(?:,|$)`,
    "i"
  );

  return {
    $or: [
      { language: exactLanguage },
      { languages: additionalLanguage },
      { additionalLanguages: additionalLanguage },
    ],
  };
}

module.exports = { buildUserLanguageFilter };
