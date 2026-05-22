const path = require("path");
const fs = require("fs");
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

function emptyQueryChain(rows = []) {
  const chain = {
    select: () => chain,
    lean: async () => rows,
  };
  return chain;
}

async function captureLiveSearchEventQuery({ mutedUserId }) {
  const captured = {
    aggregatePipeline: null,
    countQuery: null,
  };

  installMock(modelPath("user"), {
    find: () => emptyQueryChain([]),
  });

  installMock(modelPath("Follow"), {
    find: () => emptyQueryChain([]),
  });

  installMock(modelPath("event"), {
    aggregate: async (pipeline) => {
      captured.aggregatePipeline = pipeline;
      return [];
    },
    countDocuments: async (query) => {
      captured.countQuery = query;
      return 0;
    },
  });

  installMock(modulePath("utils/blockUtils.js"), {
    getBlockedUserIds: async () => [],
  });

  installMock(modulePath("utils/getMutedUserIds.js"), async () => [mutedUserId]);

  installMock(modulePath("utils/internalTestAccounts.js"), {
    getOppositeEnvironmentUserQuery: () => null,
  });

  const routePath = modulePath("routes/liveSearchRoutes.js");
  delete require.cache[require.resolve(routePath)];
  const router = require(routePath);
  const layer = router.stack.find((entry) => entry.route?.path === "/search" && entry.route?.methods?.get);
  assert(layer, "GET /live-search/search route not found");

  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const viewerId = new mongoose.Types.ObjectId();
  let statusCode = 200;

  await handler(
    {
      query: { status: "all", page: "1", limit: "20" },
      user: { _id: viewerId, accountType: "user", isVip: false },
    },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        return data;
      },
    }
  );

  assert.strictEqual(statusCode, 200);
  return captured.aggregatePipeline?.[0]?.$match || captured.countQuery;
}

async function main() {
  const mutedUserId = new mongoose.Types.ObjectId();
  const eventQuery = await captureLiveSearchEventQuery({ mutedUserId });

  assert(eventQuery, "live search did not build an event query");
  const excludedCreators = eventQuery.creatorId?.$nin || [];
  assert(
    excludedCreators.some((id) => String(id) === String(mutedUserId)),
    "live search/discover must exclude events from muted creators"
  );

  const postsRoute = fs.readFileSync(modulePath("routes/posts.js"), "utf8");
  assert(
    postsRoute.includes('it?.type === "event" || it?.type === "event_scheduled"'),
    "following-mixed must apply mute filtering to scheduled event cards too"
  );

  console.log("muted event visibility check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
