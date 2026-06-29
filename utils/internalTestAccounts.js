function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

const CAN_CROSS_AUDIENCE_EMAILS = new Set([
  "nestx_test.mantis686@simplelogin.com",
]);

function isBridgeUser(user) {
  return CAN_CROSS_AUDIENCE_EMAILS.has(normalizeEmail(user?.email));
}

function getBridgeUserConditions() {
  return Array.from(CAN_CROSS_AUDIENCE_EMAILS).map((email) => ({
    email: new RegExp(`^${escapeRegex(email)}$`, "i"),
  }));
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

function isInternalTestUser(user) {
  return user?.isInternalTest === true || isInternalTestEmail(user?.email);
}

function isAdminViewer(user) {
  return String(user?.accountType || "").toLowerCase() === "admin";
}

function getOppositeEnvironmentUserQuery(viewerUser) {
  if (isAdminViewer(viewerUser)) return null;
  if (isBridgeUser(viewerUser)) return null;

  const internalTestConditions = getInternalTestUserConditions();
  const bridgeConditions = getBridgeUserConditions();
  if (isInternalTestUser(viewerUser)) {
    return {
      $and: [
        { $nor: internalTestConditions },
        { $nor: bridgeConditions },
      ],
    };
  }

  return {
    $and: [
      { $or: internalTestConditions },
      { $nor: bridgeConditions },
    ],
  };
}

function getSameEnvironmentUserQuery(viewerUser) {
  if (isAdminViewer(viewerUser)) return null;
  if (isBridgeUser(viewerUser)) return null;

  const internalTestConditions = getInternalTestUserConditions();
  const bridgeConditions = getBridgeUserConditions();
  if (isInternalTestUser(viewerUser)) {
    return {
      $or: [
        ...internalTestConditions,
        ...bridgeConditions,
      ],
    };
  }

  return {
    $or: [
      { $nor: internalTestConditions },
      ...bridgeConditions,
    ],
  };
}

function shouldHideInternalTestUser(targetUser, viewerUser, ownerId = null) {
  if (isAdminViewer(viewerUser)) return false;
  if (isBridgeUser(viewerUser)) return false;
  if (isBridgeUser(targetUser)) return false;
  if (ownerId && String(ownerId) === String(targetUser?._id || targetUser)) return false;

  return isInternalTestUser(targetUser) !== isInternalTestUser(viewerUser);
}

module.exports = {
  CAN_CROSS_AUDIENCE_EMAILS,
  normalizeGmailAliasEmail,
  isBridgeUser,
  getBridgeUserConditions,
  isInternalTestEmail,
  getInternalTestEmailQuery,
  isInternalTestUser,
  getInternalTestUserConditions,
  getOppositeEnvironmentUserQuery,
  getSameEnvironmentUserQuery,
  isAdminViewer,
  shouldHideInternalTestUser,
};
