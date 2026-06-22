const assert = require("assert");
const { buildUserLanguageFilter } = require("./searchLanguageFilter");

function matchesField(value, matcher) {
  if (matcher instanceof RegExp) {
    if (typeof value === "string") return matcher.test(value);
    if (Array.isArray(value)) {
      return value.some(
        (item) => typeof item === "string" && matcher.test(item)
      );
    }
  }

  return false;
}

function matchesLanguage(profile, language) {
  const filter = buildUserLanguageFilter(language);
  if (!filter) return true;

  return filter.$or.some((condition) => {
    const [field, matcher] = Object.entries(condition)[0];
    return matchesField(profile[field], matcher);
  });
}

const multilingualProfile = {
  language: "fr",
  languages: ["en", "it", "", "   "],
};

assert.equal(matchesLanguage(multilingualProfile, "fr"), true);
assert.equal(matchesLanguage(multilingualProfile, "FR"), true);
assert.equal(matchesLanguage(multilingualProfile, "en"), true);
assert.equal(matchesLanguage(multilingualProfile, "IT"), true);
assert.equal(matchesLanguage(multilingualProfile, "es"), false);

const primaryOnlyProfile = { language: "de" };
assert.equal(matchesLanguage(primaryOnlyProfile, "de"), true);
assert.equal(matchesLanguage(primaryOnlyProfile, "DE"), true);
assert.equal(matchesLanguage(primaryOnlyProfile, "en"), false);

const aliasProfile = {
  language: "fr",
  additionalLanguages: ["pt"],
};
assert.equal(matchesLanguage(aliasProfile, "pt"), true);

const legacyStringProfile = {
  language: "fr",
  additionalLanguages: "en, it",
};
assert.equal(matchesLanguage(legacyStringProfile, "en"), true);
assert.equal(matchesLanguage(legacyStringProfile, "it"), true);
assert.equal(matchesLanguage(legacyStringProfile, "es"), false);

const femaleMultilingualProfile = {
  profileType: "female",
  language: "fr",
  languages: ["en", "it"],
};
assert.equal(
  femaleMultilingualProfile.profileType === "female" &&
    matchesLanguage(femaleMultilingualProfile, "it"),
  true
);

assert.equal(buildUserLanguageFilter("   "), null);
assert.equal(matchesLanguage(multilingualProfile, ""), true);

console.log("searchLanguageFilter checks passed");
