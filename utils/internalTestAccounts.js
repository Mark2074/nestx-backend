function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeGmailAliasEmail(value) {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const isGmail = domain === "gmail.com" || domain === "googlemail.com";
  if (!isGmail) return email;

  const baseLocal = local.split("+")[0];
  return `${baseLocal}@gmail.com`;
}

function getInternalTestEmailBase() {
  return normalizeGmailAliasEmail(process.env.INTERNAL_TEST_EMAIL_BASE);
}

function isInternalTestEmail(email) {
  const base = getInternalTestEmailBase();
  if (!base) return false;
  return normalizeGmailAliasEmail(email) === base;
}

function getInternalTestEmailQuery() {
  const base = getInternalTestEmailBase();
  const at = base.lastIndexOf("@");
  if (at <= 0) return null;

  const local = base.slice(0, at);
  const domain = base.slice(at + 1);
  if (domain !== "gmail.com") return { email: base };

  return {
    email: new RegExp(`^${escapeRegex(local)}(\\+[^@]+)?@(gmail\\.com|googlemail\\.com)$`, "i"),
  };
}

function getInternalTestUserConditions() {
  const conditions = [{ isInternalTest: true }];
  const emailQuery = getInternalTestEmailQuery();
  if (emailQuery) conditions.push(emailQuery);
  return conditions;
}

function isAdminViewer(user) {
  return String(user?.accountType || "").toLowerCase() === "admin";
}

function shouldHideInternalTestUser(targetUser, viewerUser, ownerId = null) {
  if (!targetUser?.isInternalTest && !isInternalTestEmail(targetUser?.email)) return false;
  if (isAdminViewer(viewerUser)) return false;
  if (ownerId && String(ownerId) === String(targetUser?._id || targetUser)) return false;
  return true;
}

module.exports = {
  normalizeGmailAliasEmail,
  isInternalTestEmail,
  getInternalTestUserConditions,
  isAdminViewer,
  shouldHideInternalTestUser,
};
