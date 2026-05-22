const path = require("path");
const assert = require("assert");
const mongoose = require("mongoose");

const root = path.resolve(__dirname, "..");

function modelPath(name) {
  return path.join(root, "models", name);
}

function modulePath(name) {
  return path.join(root, name);
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

async function runReportPatch({ report, body }) {
  const calls = {
    postUpdates: [],
    commentUpdates: [],
    liveMessageUpdates: [],
    auditLogs: [],
    notifications: [],
    trustEvents: [],
  };

  const updatedReport = { ...report, status: body.status };

  installMock(modelPath("Report"), {
    findById: () => ({
      lean: async () => report,
    }),
    findByIdAndUpdate: async () => updatedReport,
    updateOne: async () => ({ acknowledged: true }),
  });

  installMock(modelPath("Post"), {
    updateOne: async (...args) => {
      calls.postUpdates.push(args);
      return { acknowledged: true };
    },
    findById: () => ({
      select: () => ({
        lean: async () => ({ authorId: report.targetOwnerId }),
      }),
    }),
  });

  installMock(modelPath("Comment"), {
    updateOne: async (...args) => {
      calls.commentUpdates.push(args);
      return { acknowledged: true };
    },
    findById: () => ({
      select: () => ({
        lean: async () => ({ authorId: report.targetOwnerId }),
      }),
    }),
  });

  installMock(modelPath("LiveMessage"), {
    updateOne: async (...args) => {
      calls.liveMessageUpdates.push(args);
      return { acknowledged: true };
    },
    findById: () => ({
      select: () => ({
        lean: async () => ({ userId: report.targetOwnerId }),
      }),
    }),
  });

  installMock(modelPath("AdminAuditLog"), {
    create: async (doc) => {
      calls.auditLogs.push(doc);
      return doc;
    },
  });

  installMock(modelPath("notification"), {
    updateMany: async (...args) => {
      calls.notifications.push(args);
      return { acknowledged: true };
    },
  });

  installMock(modulePath("services/accountTrustRecordService.js"), {
    appendAccountTrustEvent: async (event) => {
      calls.trustEvents.push(event);
      return event;
    },
  });

  for (const name of ["event", "user", "ticket"]) {
    installMock(modelPath(name), {
      findById: () => ({
        select: () => ({
          lean: async () => null,
        }),
      }),
      updateOne: async () => ({ acknowledged: true }),
    });
  }

  installMock(modulePath("routes/adminRefundRoutes.js"), {
    adminRefundTicketById: async () => ({ ok: true }),
  });

  installMock(modulePath("services/eventCancellationService.js"), {
    cancelScheduledEventsForCreator: async () => null,
  });

  const routePath = modulePath("routes/adminReportsRoutes.js");
  delete require.cache[require.resolve(routePath)];
  const router = require(routePath);
  const layer = router.stack.find((entry) => entry.route?.path === "/reports/:id" && entry.route?.methods?.patch);
  assert(layer, "PATCH /reports/:id route not found");

  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let statusCode = 200;
  let payload = null;

  await handler(
    {
      params: { id: String(report._id) },
      body,
      user: { _id: new mongoose.Types.ObjectId(), accountType: "admin" },
      headers: {},
      socket: {},
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

  return { calls, statusCode, payload };
}

async function main() {
  const AccountTrustRecord = require(modelPath("AccountTrustRecord"));
  const trustRecord = new AccountTrustRecord({
    userId: new mongoose.Types.ObjectId(),
    lastEvents: [
      {
        kind: "report_actioned",
        targetType: "comment",
        targetId: new mongoose.Types.ObjectId(),
      },
    ],
  });
  assert.strictEqual(
    trustRecord.validateSync(),
    undefined,
    "trust audit must accept comment report targets"
  );

  const report = {
    _id: new mongoose.Types.ObjectId(),
    targetType: "comment",
    targetId: new mongoose.Types.ObjectId(),
    targetOwnerId: new mongoose.Types.ObjectId(),
    reporterId: new mongoose.Types.ObjectId(),
    status: "pending",
    reason: "Reported comment",
    reasonCode: "other",
  };

  const hidden = await runReportPatch({
    report,
    body: { status: "hidden", adminNote: "hide comment only" },
  });

  assert.strictEqual(hidden.statusCode, 200);
  assert.strictEqual(hidden.calls.postUpdates.length, 0, "hide comment must not update Post");
  assert.strictEqual(hidden.calls.commentUpdates.length, 1, "hide comment must update Comment once");
  assert.strictEqual(
    hidden.calls.commentUpdates[0][1].$set["moderation.status"],
    "hidden",
    "hide comment must mark the comment hidden"
  );

  const actioned = await runReportPatch({
    report,
    body: { status: "actioned", severity: "grave", adminNote: "action comment only" },
  });

  assert.strictEqual(actioned.statusCode, 200);
  assert.strictEqual(actioned.calls.postUpdates.length, 0, "action comment must not update Post");
  assert.strictEqual(actioned.calls.commentUpdates.length, 1, "action comment must update Comment once");
  assert.strictEqual(actioned.calls.commentUpdates[0][1].$set["moderation.status"], "hidden");

  console.log("admin report moderation scope check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
