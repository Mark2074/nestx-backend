function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildUserLanguageFilter(language) {
  const normalized = String(language || "").trim();
  if (!normalized) return null;

  const exactLanguage = new RegExp(`^${escapeRegex(normalized)}$`, "i");

  return {
    $or: [
      { language: exactLanguage },
      { languages: { $elemMatch: exactLanguage } },
      { additionalLanguages: { $elemMatch: exactLanguage } },
    ],
  };
}

module.exports = { buildUserLanguageFilter };
