const MENTION_PATTERN = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{3,30})(?![a-zA-Z0-9_])/g;

function extractMentionUsernames(text) {
  const value = String(text || "");
  const usernames = new Set();
  let match;

  while ((match = MENTION_PATTERN.exec(value))) {
    usernames.add(String(match[2] || "").trim().toLowerCase());
  }

  return [...usernames];
}

module.exports = {
  MENTION_PATTERN,
  extractMentionUsernames,
};
