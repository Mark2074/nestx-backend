const assert = require("assert");
const {
  normalizeEditableUsername,
  validateOptionalUsername,
} = require("./username");

assert.equal(normalizeEditableUsername("Tizio"), "tizio");
assert.equal(normalizeEditableUsername("@Tizio"), "tizio");
assert.equal(normalizeEditableUsername("  @@Tizio_1  "), "tizio_1");

assert.deepEqual(validateOptionalUsername(""), {
  ok: true,
  username: null,
});
assert.deepEqual(validateOptionalUsername(null), {
  ok: true,
  username: null,
});

assert.equal(validateOptionalUsername("valid_name").ok, true);
assert.equal(validateOptionalUsername("@Valid_Name").username, "valid_name");
assert.equal(validateOptionalUsername("bad name").ok, false);
assert.equal(validateOptionalUsername("bad!").ok, false);
assert.equal(validateOptionalUsername("ab").ok, false);
assert.equal(validateOptionalUsername("admin").ok, false);

console.log("username checks passed");
