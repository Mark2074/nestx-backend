const assert = require("assert");
const { buildUserLanguageFilter } = require("./searchLanguageFilter");

function matchesField(value, matcher) {
  if (matcher instanceof RegExp) {
    return typeof value === "string" && matcher.test(value);
  }

  if (matcher && matcher.$elemMatch instanceof RegExp) {
    return (
      Array.isArray(value) &&
      value.some(
        (item) =>
          typeof item === "string" &&
          matcher.$elemMatch.test(item)
      )
    );
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

assert.equal(buildUserLanguageFilter("   "), null);

console.log("searchLanguageFilter checks passed");
