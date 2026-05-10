const assert = require("assert");

process.env.INTERNAL_TEST_EMAIL_BASE = "realemail@gmail.com";

const {
  normalizeGmailAliasEmail,
  isInternalTestEmail,
  getInternalTestUserConditions,
  shouldHideInternalTestUser,
} = require("./internalTestAccounts");

assert.strictEqual(
  normalizeGmailAliasEmail("realemail+base@gmail.com"),
  "realemail@gmail.com"
);
assert.strictEqual(isInternalTestEmail("realemail+vip@gmail.com"), true);
assert.strictEqual(isInternalTestEmail("realemail+test@gmail.com"), true);
assert.strictEqual(isInternalTestEmail("normal@gmail.com"), false);

const internalUser = { _id: "internal-user", isInternalTest: true };
const internalAliasUser = { _id: "internal-alias-user", email: "realemail+old@gmail.com" };
const normalViewer = { _id: "normal-user", accountType: "base" };
const adminViewer = { _id: "admin-user", accountType: "admin" };

assert.strictEqual(getInternalTestUserConditions().length, 2);
assert.strictEqual(shouldHideInternalTestUser(internalUser, normalViewer), true);
assert.strictEqual(shouldHideInternalTestUser(internalAliasUser, normalViewer), true);
assert.strictEqual(shouldHideInternalTestUser(internalUser, adminViewer), false);
assert.strictEqual(
  shouldHideInternalTestUser(internalUser, normalViewer, "internal-user"),
  false
);

console.log("Internal test account checks passed");
