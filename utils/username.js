const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;

const RESERVED_USERNAMES = new Set([
  "admin",
  "api",
  "auth",
  "profile",
  "settings",
  "support",
  "me",
  "live",
  "post",
  "posts",
  "search",
]);

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function isReservedUsername(value) {
  return RESERVED_USERNAMES.has(normalizeUsername(value));
}

function validateUsername(value) {
  const username = normalizeUsername(value);

  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      username,
      code: "USERNAME_INVALID",
      message: "Username must be 3-30 characters and use only lowercase letters, numbers, and underscores.",
    };
  }

  if (isReservedUsername(username)) {
    return {
      ok: false,
      username,
      code: "USERNAME_RESERVED",
      message: "Username is reserved.",
    };
  }

  return { ok: true, username };
}

function usernameBaseFromDisplayName(displayName) {
  const base = normalizeUsername(displayName)
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);

  if (USERNAME_PATTERN.test(base) && !isReservedUsername(base)) {
    return base;
  }

  return "";
}

module.exports = {
  USERNAME_PATTERN,
  RESERVED_USERNAMES,
  normalizeUsername,
  isReservedUsername,
  validateUsername,
  usernameBaseFromDisplayName,
};
