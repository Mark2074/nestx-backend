const path = require("path");
const assert = require("assert");
const mongoose = require("mongoose");

const root = path.resolve(__dirname, "..");

function modulePath(name) {
  return path.join(root, name);
}

function modelPath(name) {
  return path.join(root, "models", name);
}

function installMock(moduleFile, exportsValue) {
  const resolved = require.resolve(moduleFile);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue,
  };
}

function emptyQueryChain() {
  const chain = {
    select: () => chain,
    populate: () => chain,
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: async () => [],
  };
  return chain;
}

function postFindChain() {
  const chain = {
    select: () => chain,
    populate: () => chain,
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: async () => [],
  };
  return chain;
}

async function captureSearchPostQuery() {
  const captured = { postFindQuery: null };

  installMock(modelPath("user"), {
    find: () => emptyQueryChain(),
  });

  installMock(modelPath("Post"), {
    find: (query) => {
      captured.postFindQuery = query;
      return postFindChain();
    },
  });

  installMock(modelPath("event"), {
    find: () => emptyQueryChain(),
  });

  installMock(modelPath("Follow"), {
    find: () => emptyQueryChain(),
  });

  installMock(modelPath("SensitiveDictionaryEntry"), {
    find: () => ({
      lean: async () => [],
    }),
  });

  installMock(modelPath("ProhibitedSearchLog"), {
    create: async () => ({}),
  });

  installMock(modelPath("AccountTrustRecord"), {
    findOneAndUpdate: async () => ({
      confirmedTotal: 0,
      confirmedGrave: 0,
      confirmedGravissimo: 0,
      tier: "OK",
      tierScore: 0,
    }),
    updateOne: async () => ({}),
  });

  installMock(modulePath("utils/blockUtils.js"), {
    getBlockedUserIds: async () => [],
  });

  installMock(modulePath("utils/internalTestAccounts.js"), {
    getOppositeEnvironmentUserQuery: () => null,
  });

  installMock(modulePath("utils/publicSocialUser.js"), {
    publicActiveUserQuery: (query = {}) => ({
      ...query,
      accountType: { $ne: "admin" },
      isBanned: { $ne: true },
      isDeleted: { $ne: true },
    }),
  });

  const routePath = modulePath("routes/searchRoutes.js");
  delete require.cache[require.resolve(routePath)];
  const router = require(routePath);
  const layer = router.stack.find((entry) => entry.route?.path === "/search" && entry.route?.methods?.get);
  assert(layer, "GET /search route not found");

  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const meId = new mongoose.Types.ObjectId();
  let payload = null;
  let statusCode = 200;

  await handler(
    {
      query: { type: "posts", q: "test", page: "1", limit: "10" },
      user: { _id: meId, accountType: "user", isVip: false },
    },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        payload = data;
        return data;
      },
    }
  );

  assert.strictEqual(statusCode, 200);
  assert(payload, "search handler did not return a payload");
  return captured.postFindQuery;
}

async function main() {
  const searchPostQuery = await captureSearchPostQuery();

  assert(searchPostQuery, "search did not query posts");
  assert.deepStrictEqual(
    searchPostQuery.isHidden,
    { $ne: true },
    "search must exclude legacy hidden posts"
  );
  assert.strictEqual(
    searchPostQuery["moderation.status"],
    "visible",
    "search must only return visible posts"
  );
  assert.deepStrictEqual(
    searchPostQuery["moderation.isDeleted"],
    { $ne: true },
    "search must exclude moderation-deleted posts"
  );

  console.log("public post visibility check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
