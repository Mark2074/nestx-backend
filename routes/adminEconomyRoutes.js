// routes/adminEconomyRoutes.js
const express = require("express");
const mongoose = require("mongoose");

const auth = require("../middleware/authMiddleware");
const adminGuard = require("../middleware/adminGuard");
const User = require("../models/user");
const TokenTransaction = require("../models/tokenTransaction");
const Event = require("../models/event");
const Notification = require("../models/notification");
const AdminAuditLog = require("../models/AdminAuditLog");
const ActionAuditLog = require("../models/ActionAuditLog");
const Ticket = require("../models/ticket");
const RefundLog = require("../models/RefundLog");
const crypto = require("crypto");
const { appendAccountTrustEvent } = require("../services/accountTrustRecordService");
const {
  getMetricEnvironment,
  getValidJoinedUserMetricMatch,
  getValidUserMetricMatch,
} = require("../utils/adminMetricUserFilters");
const {
  getInternalTestUserConditions,
  isInternalTestUser,
} = require("../utils/internalTestAccounts");

const {
  freezeNativePrivateHeldEvent,
  refundNativePrivateHeldOrFrozenEvent,
} = require("../services/nativePrivateEconomicService");

const router = express.Router();

function clampPositiveInt(value, min, max, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const x = Math.floor(n);
  if (x < min || x > max) return fallback;
  return x;
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).trim();
  return req.ip || null;
}

function getActiveInternalTestAccountQuery() {
  return {
    $and: [
      { $or: getInternalTestUserConditions() },
      {
        isDeleted: { $ne: true },
        deletedAt: null,
        isBanned: { $ne: true },
        isSuspended: { $ne: true },
      },
    ],
  };
}

function isActiveInternalTestAccount(user) {
  return (
    isInternalTestUser(user) &&
    user?.isDeleted !== true &&
    !user?.deletedAt &&
    user?.isBanned !== true &&
    user?.isSuspended !== true
  );
}

function getCreatorState(user) {
  return String(user?.accountType || "").toLowerCase() === "creator" || user?.isCreator === true
    ? "creator"
    : "base";
}

async function writeAdminTestAudit(req, {
  actionType,
  targetUserId,
  amountTokens = null,
  vipDays = null,
  opId = null,
  groupId = null,
  before = null,
  after = null,
  note = null,
}) {
  const meta = {
    testOnly: true,
    amountTokens,
    vipDays,
    opId,
    groupId,
    note,
    before,
    after,
    ip: getClientIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 500) || null,
  };

  await Promise.allSettled([
    AdminAuditLog.create({
      adminId: req.user?._id || null,
      actionType,
      targetType: "user",
      targetId: String(targetUserId),
      meta,
    }),
    ActionAuditLog.create({
      actorId: req.user?._id,
      actorRole: "admin",
      actionType,
      targetType: "user",
      targetId: String(targetUserId),
      reason: "internal_test_utility",
      meta,
      ip: meta.ip,
      userAgent: meta.userAgent,
    }),
  ]);
}

// GET /api/admin/economy/test-accounts
// Future "Test accounts" surface: lists only internal-test scoped accounts.
router.get("/test-accounts", auth, adminGuard, async (req, res) => {
  try {
    const users = await User.find(getActiveInternalTestAccountQuery())
      .select(
        "_id email displayName username avatar accountType isInternalTest isVip vipExpiresAt tokenBalance tokenPurchased tokenEarnings tokenRedeemable tokenHeld isCreator creatorEnabled creatorVerification payoutEnabled payoutStatus createdAt"
      )
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.json({
      status: "ok",
      data: users.map((user) => ({
        ...user,
        eligibleForTestGrants: isInternalTestUser(user),
        creatorState: getCreatorState(user),
      })),
    });
  } catch (e) {
    console.error("admin test accounts list error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/admin/economy/test-accounts/:userId/grant-tokens
router.post("/test-accounts/:userId/grant-tokens", auth, adminGuard, async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const targetUserId = String(req.params.userId || "").trim();
    const amountTokens = clampPositiveInt(req.body?.amountTokens, 1, 1_000_000);
    const note = String(req.body?.note || "").trim().slice(0, 300) || null;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ status: "error", code: "INVALID_USER_ID", message: "Invalid user ID" });
    }

    if (!amountTokens) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_TOKEN_AMOUNT",
        message: "amountTokens must be an integer between 1 and 1000000",
      });
    }

    const opIdRaw = String(req.body?.opId || req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || "").trim();
    const opId = opIdRaw.length >= 8 ? opIdRaw.slice(0, 120) : `admin_test_grant_${crypto.randomUUID()}`;
    const groupId = `grp_${crypto.randomUUID()}`;

    let updatedUser = null;
    let txDoc = null;
    let before = null;

    await session.withTransaction(async () => {
      const target = await User.findById(targetUserId)
        .select("_id email displayName isInternalTest isDeleted deletedAt isBanned isSuspended tokenBalance tokenPurchased tokenEarnings tokenRedeemable tokenHeld")
        .session(session);

      if (!target) {
        const err = new Error("User not found");
        err.statusCode = 404;
        err.code = "USER_NOT_FOUND";
        throw err;
      }

      if (!isInternalTestUser(target)) {
        const err = new Error("Test token grants are allowed only for internal test accounts");
        err.statusCode = 403;
        err.code = "TARGET_NOT_INTERNAL_TEST";
        throw err;
      }

      if (!isActiveInternalTestAccount(target)) {
        const err = new Error("Test token grants are allowed only for active internal test accounts");
        err.statusCode = 403;
        err.code = "TARGET_TEST_ACCOUNT_INACTIVE";
        throw err;
      }

      before = {
        tokenBalance: Number(target.tokenBalance || 0),
        tokenPurchased: Number(target.tokenPurchased || 0),
        tokenEarnings: Number(target.tokenEarnings || 0),
        tokenRedeemable: Number(target.tokenRedeemable || 0),
        tokenHeld: Number(target.tokenHeld || 0),
      };

      const existing = await TokenTransaction.findOne({
        opId,
        kind: "admin_test_grant",
        direction: "credit",
        toUserId: target._id,
      }).session(session);

      if (existing) {
        txDoc = existing;
        updatedUser = await User.findById(target._id)
          .select("tokenBalance tokenPurchased tokenEarnings tokenRedeemable tokenHeld isInternalTest")
          .session(session);
        return;
      }

      updatedUser = await User.findByIdAndUpdate(
        target._id,
        {
          $inc: {
            tokenBalance: amountTokens,
            tokenPurchased: amountTokens,
          },
        },
        { new: true, session }
      ).select("tokenBalance tokenPurchased tokenEarnings tokenRedeemable tokenHeld isInternalTest");

      txDoc = await TokenTransaction.create(
        [
          {
            opId,
            groupId,
            fromUserId: null,
            toUserId: target._id,
            kind: "admin_test_grant",
            direction: "credit",
            context: "system",
            amountTokens,
            amountEuro: 0,
            metadata: {
              testOnly: true,
              grantedByAdminId: String(req.user?._id || ""),
              note,
            },
          },
        ],
        { session }
      ).then((rows) => rows[0]);

      await Notification.create(
        [
          {
            userId: target._id,
            actorId: req.user?._id || null,
            type: "TOKEN_RECEIVED",
            targetType: "token_tx",
            targetId: txDoc._id,
            message: `Test token grant: +${amountTokens} token`,
            data: {
              kind: "admin_test_grant",
              testOnly: true,
              amountTokens,
              opId,
              groupId,
            },
            isPersistent: true,
            dedupeKey: `token_tx:${opId}:admin_test_grant`,
          },
        ],
        { session }
      );
    });

    await writeAdminTestAudit(req, {
      actionType: "ADMIN_TEST_TOKEN_GRANT",
      targetUserId,
      amountTokens,
      opId,
      groupId,
      before,
      after: {
        tokenBalance: Number(updatedUser?.tokenBalance || 0),
        tokenPurchased: Number(updatedUser?.tokenPurchased || 0),
        tokenEarnings: Number(updatedUser?.tokenEarnings || 0),
        tokenRedeemable: Number(updatedUser?.tokenRedeemable || 0),
        tokenHeld: Number(updatedUser?.tokenHeld || 0),
      },
      note,
    });

    return res.status(201).json({
      status: "ok",
      data: {
        targetUserId,
        amountTokens,
        opId,
        transactionId: txDoc?._id || null,
        tokenBalance: Number(updatedUser?.tokenBalance || 0),
        tokenPurchased: Number(updatedUser?.tokenPurchased || 0),
        tokenEarnings: Number(updatedUser?.tokenEarnings || 0),
        tokenRedeemable: Number(updatedUser?.tokenRedeemable || 0),
        tokenHeld: Number(updatedUser?.tokenHeld || 0),
      },
    });
  } catch (e) {
    console.error("admin test token grant error:", e);
    return res.status(e.statusCode || 500).json({
      status: "error",
      code: e.code || "TEST_TOKEN_GRANT_FAILED",
      message: e.message || "Internal error",
    });
  } finally {
    session.endSession();
  }
});

// POST /api/admin/economy/test-accounts/:userId/grant-vip
router.post("/test-accounts/:userId/grant-vip", auth, adminGuard, async (req, res) => {
  try {
    const targetUserId = String(req.params.userId || "").trim();
    const vipDays = clampPositiveInt(req.body?.days ?? 30, 1, 366, 30);
    const note = String(req.body?.note || "").trim().slice(0, 300) || null;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ status: "error", code: "INVALID_USER_ID", message: "Invalid user ID" });
    }

    const target = await User.findById(targetUserId)
      .select("_id email displayName isInternalTest isDeleted deletedAt isBanned isSuspended isVip vipExpiresAt vipAutoRenew vipSince")
      .lean();

    if (!target) {
      return res.status(404).json({ status: "error", code: "USER_NOT_FOUND", message: "User not found" });
    }

    if (!isInternalTestUser(target)) {
      return res.status(403).json({
        status: "error",
        code: "TARGET_NOT_INTERNAL_TEST",
        message: "Test VIP grants are allowed only for internal test accounts",
      });
    }

    if (!isActiveInternalTestAccount(target)) {
      return res.status(403).json({
        status: "error",
        code: "TARGET_TEST_ACCOUNT_INACTIVE",
        message: "Test VIP grants are allowed only for active internal test accounts",
      });
    }

    const now = new Date();
    const currentExp = target.vipExpiresAt ? new Date(target.vipExpiresAt) : null;
    const base = currentExp && currentExp > now ? currentExp : now;
    const vipExpiresAt = new Date(base.getTime() + vipDays * 24 * 60 * 60 * 1000);

    const updated = await User.findByIdAndUpdate(
      target._id,
      {
        $set: {
          isVip: true,
          vipExpiresAt,
          vipAutoRenew: false,
          ...(target.vipSince ? {} : { vipSince: now }),
        },
      },
      { new: true }
    ).select("_id isVip vipExpiresAt vipAutoRenew vipSince isInternalTest");

    await Notification.create({
      userId: target._id,
      actorId: req.user?._id || null,
      type: "SYSTEM_VIP_CHANGED",
      targetType: "user",
      targetId: target._id,
      message: `Test VIP granted for ${vipDays} day${vipDays === 1 ? "" : "s"}`,
      data: {
        testOnly: true,
        vipDays,
        vipExpiresAt,
      },
      isPersistent: false,
      dedupeKey: `test_vip_grant:${target._id}:${vipExpiresAt.getTime()}`,
    });

    await writeAdminTestAudit(req, {
      actionType: "ADMIN_TEST_VIP_GRANT",
      targetUserId,
      vipDays,
      before: {
        isVip: target.isVip === true,
        vipExpiresAt: target.vipExpiresAt || null,
        vipAutoRenew: target.vipAutoRenew === true,
      },
      after: {
        isVip: updated?.isVip === true,
        vipExpiresAt: updated?.vipExpiresAt || null,
        vipAutoRenew: updated?.vipAutoRenew === true,
      },
      note,
    });

    return res.json({
      status: "ok",
      data: {
        targetUserId,
        isVip: updated?.isVip === true,
        vipExpiresAt: updated?.vipExpiresAt || null,
        vipAutoRenew: updated?.vipAutoRenew === true,
        vipDays,
      },
    });
  } catch (e) {
    console.error("admin test vip grant error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/admin/economy/test-accounts/:userId/revoke-vip
router.post("/test-accounts/:userId/revoke-vip", auth, adminGuard, async (req, res) => {
  try {
    const targetUserId = String(req.params.userId || "").trim();
    const note = String(req.body?.note || "").trim().slice(0, 300) || null;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ status: "error", code: "INVALID_USER_ID", message: "Invalid user ID" });
    }

    const target = await User.findById(targetUserId)
      .select("_id email displayName isInternalTest isDeleted deletedAt isBanned isSuspended isVip vipExpiresAt vipAutoRenew vipSince")
      .lean();

    if (!target) {
      return res.status(404).json({ status: "error", code: "USER_NOT_FOUND", message: "User not found" });
    }

    if (!isInternalTestUser(target)) {
      return res.status(403).json({
        status: "error",
        code: "TARGET_NOT_INTERNAL_TEST",
        message: "Test VIP changes are allowed only for internal test accounts",
      });
    }

    if (!isActiveInternalTestAccount(target)) {
      return res.status(403).json({
        status: "error",
        code: "TARGET_TEST_ACCOUNT_INACTIVE",
        message: "Test VIP changes are allowed only for active internal test accounts",
      });
    }

    const updated = await User.findByIdAndUpdate(
      target._id,
      {
        $set: {
          isVip: false,
          vipExpiresAt: null,
          vipAutoRenew: false,
          vipSince: null,
        },
      },
      { new: true }
    ).select("_id isVip vipExpiresAt vipAutoRenew vipSince isInternalTest");

    await Notification.create({
      userId: target._id,
      actorId: req.user?._id || null,
      type: "SYSTEM_VIP_CHANGED",
      targetType: "user",
      targetId: target._id,
      message: "Test VIP revoked",
      data: {
        testOnly: true,
        vipExpiresAt: null,
      },
      isPersistent: false,
      dedupeKey: `test_vip_revoke:${target._id}:${Date.now()}`,
    });

    await writeAdminTestAudit(req, {
      actionType: "ADMIN_TEST_VIP_REVOKE",
      targetUserId,
      before: {
        isVip: target.isVip === true,
        vipExpiresAt: target.vipExpiresAt || null,
        vipAutoRenew: target.vipAutoRenew === true,
        vipSince: target.vipSince || null,
      },
      after: {
        isVip: updated?.isVip === true,
        vipExpiresAt: updated?.vipExpiresAt || null,
        vipAutoRenew: updated?.vipAutoRenew === true,
        vipSince: updated?.vipSince || null,
      },
      note,
    });

    return res.json({
      status: "ok",
      data: {
        targetUserId,
        isVip: updated?.isVip === true,
        vipExpiresAt: updated?.vipExpiresAt || null,
        vipAutoRenew: updated?.vipAutoRenew === true,
      },
    });
  } catch (e) {
    console.error("admin test vip revoke error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/admin/economy/test-accounts/:userId/assign-creator
router.post("/test-accounts/:userId/assign-creator", auth, adminGuard, async (req, res) => {
  try {
    const targetUserId = String(req.params.userId || "").trim();
    const note = String(req.body?.note || "").trim().slice(0, 300) || null;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ status: "error", code: "INVALID_USER_ID", message: "Invalid user ID" });
    }

    const target = await User.findById(targetUserId).select(`
      _id
      email
      displayName
      isInternalTest
      isDeleted
      deletedAt
      isBanned
      isSuspended
      accountType
      isCreator
      creatorEnabled
      creatorDisabledReason
      creatorDisabledAt
      creatorVerification
      payoutEnabled
      payoutStatus
    `);

    if (!target) {
      return res.status(404).json({ status: "error", code: "USER_NOT_FOUND", message: "User not found" });
    }

    if (!isInternalTestUser(target)) {
      return res.status(403).json({
        status: "error",
        code: "TARGET_NOT_INTERNAL_TEST",
        message: "Test Creator changes are allowed only for internal test accounts",
      });
    }

    if (!isActiveInternalTestAccount(target)) {
      return res.status(403).json({
        status: "error",
        code: "TARGET_TEST_ACCOUNT_INACTIVE",
        message: "Test Creator changes are allowed only for active internal test accounts",
      });
    }

    if (target.accountType === "admin") {
      return res.status(403).json({ status: "error", code: "TARGET_ADMIN", message: "Admins cannot be changed here" });
    }

    const before = {
      accountType: target.accountType || "base",
      isCreator: target.isCreator === true,
      creatorEnabled: target.creatorEnabled === true,
      creatorDisabledReason: target.creatorDisabledReason || null,
      creatorDisabledAt: target.creatorDisabledAt || null,
      creatorVerificationStatus: target.creatorVerification?.status || "none",
      verifiedAt: target.creatorVerification?.verifiedAt || null,
      verifiedByAdminId: target.creatorVerification?.verifiedByAdminId || null,
      payoutEnabled: target.payoutEnabled === true,
      payoutStatus: target.payoutStatus || null,
    };

    const now = new Date();
    target.isCreator = true;
    target.accountType = "creator";
    target.creatorEnabled = true;
    target.creatorDisabledReason = null;
    target.creatorDisabledAt = null;

    target.creatorVerification = target.creatorVerification || {};
    target.creatorVerification.status = "approved";
    target.creatorVerification.verifiedAt = now;
    target.creatorVerification.verifiedByAdminId = req.user?._id || null;
    target.creatorVerification.rejectedAt = null;
    target.creatorVerification.rejectedByAdminId = null;
    target.creatorVerification.rejectionReason = null;
    if (note) target.creatorVerification.note = note;

    await target.save();

    await writeAdminTestAudit(req, {
      actionType: "ADMIN_TEST_CREATOR_ASSIGN",
      targetUserId,
      before,
      after: {
        accountType: target.accountType || "base",
        isCreator: target.isCreator === true,
        creatorEnabled: target.creatorEnabled === true,
        creatorDisabledReason: target.creatorDisabledReason || null,
        creatorDisabledAt: target.creatorDisabledAt || null,
        creatorVerificationStatus: target.creatorVerification?.status || "none",
        verifiedAt: target.creatorVerification?.verifiedAt || null,
        verifiedByAdminId: target.creatorVerification?.verifiedByAdminId || null,
        payoutEnabled: target.payoutEnabled === true,
        payoutStatus: target.payoutStatus || null,
      },
      note,
    });

    return res.json({
      status: "ok",
      data: {
        targetUserId,
        accountType: target.accountType,
        isCreator: target.isCreator === true,
        creatorEnabled: target.creatorEnabled === true,
        creatorVerificationStatus: target.creatorVerification?.status || "none",
      },
    });
  } catch (e) {
    console.error("admin test creator assign error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/admin/economy/test-accounts/:userId/revoke-creator
router.post("/test-accounts/:userId/revoke-creator", auth, adminGuard, async (req, res) => {
  try {
    const targetUserId = String(req.params.userId || "").trim();
    const note = String(req.body?.note || "").trim().slice(0, 300) || null;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ status: "error", code: "INVALID_USER_ID", message: "Invalid user ID" });
    }

    const target = await User.findById(targetUserId).select(`
      _id
      email
      displayName
      isInternalTest
      isDeleted
      deletedAt
      isBanned
      isSuspended
      accountType
      isCreator
      creatorEnabled
      creatorDisabledReason
      creatorDisabledAt
      creatorVerification
      payoutEnabled
      payoutStatus
    `);

    if (!target) {
      return res.status(404).json({ status: "error", code: "USER_NOT_FOUND", message: "User not found" });
    }

    if (!isInternalTestUser(target)) {
      return res.status(403).json({
        status: "error",
        code: "TARGET_NOT_INTERNAL_TEST",
        message: "Test Creator changes are allowed only for internal test accounts",
      });
    }

    if (!isActiveInternalTestAccount(target)) {
      return res.status(403).json({
        status: "error",
        code: "TARGET_TEST_ACCOUNT_INACTIVE",
        message: "Test Creator changes are allowed only for active internal test accounts",
      });
    }

    if (target.accountType === "admin") {
      return res.status(403).json({ status: "error", code: "TARGET_ADMIN", message: "Admins cannot be changed here" });
    }

    const before = {
      accountType: target.accountType || "base",
      isCreator: target.isCreator === true,
      creatorEnabled: target.creatorEnabled === true,
      creatorDisabledReason: target.creatorDisabledReason || null,
      creatorDisabledAt: target.creatorDisabledAt || null,
      creatorVerificationStatus: target.creatorVerification?.status || "none",
      payoutEnabled: target.payoutEnabled === true,
      payoutStatus: target.payoutStatus || null,
    };

    const now = new Date();
    target.isCreator = false;
    target.accountType = "base";
    target.creatorEnabled = false;
    target.creatorDisabledReason = "ADMIN_TEST_CREATOR_REVOKED";
    target.creatorDisabledAt = now;

    target.creatorVerification = target.creatorVerification || {};
    target.creatorVerification.status = "none";
    target.creatorVerification.verifiedAt = null;
    target.creatorVerification.verifiedByAdminId = null;
    target.creatorVerification.rejectedAt = null;
    target.creatorVerification.rejectedByAdminId = null;
    target.creatorVerification.rejectionReason = null;
    if (note) target.creatorVerification.note = note;

    await target.save();

    await writeAdminTestAudit(req, {
      actionType: "ADMIN_TEST_CREATOR_REVOKE",
      targetUserId,
      before,
      after: {
        accountType: target.accountType || "base",
        isCreator: target.isCreator === true,
        creatorEnabled: target.creatorEnabled === true,
        creatorDisabledReason: target.creatorDisabledReason || null,
        creatorDisabledAt: target.creatorDisabledAt || null,
        creatorVerificationStatus: target.creatorVerification?.status || "none",
        payoutEnabled: target.payoutEnabled === true,
        payoutStatus: target.payoutStatus || null,
      },
      note,
    });

    return res.json({
      status: "ok",
      data: {
        targetUserId,
        accountType: target.accountType,
        isCreator: target.isCreator === true,
        creatorEnabled: target.creatorEnabled === true,
        creatorVerificationStatus: target.creatorVerification?.status || "none",
      },
    });
  } catch (e) {
    console.error("admin test creator revoke error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// GET /api/admin/economy/summary (admin-only)
router.get("/summary", auth, adminGuard, async (req, res) => {
  try {
    const environment = getMetricEnvironment(req);
    const validUserMatch = getValidUserMetricMatch(environment);

    const usersAgg = await User.aggregate([
      { $match: validUserMatch },
      {
        $group: {
          _id: null,
          circulatingTokens: { $sum: "$tokenBalance" },
          redeemableTokens: { $sum: "$tokenEarnings" },
        },
      },
    ]);

    const circulatingTokens = usersAgg?.[0]?.circulatingTokens || 0;
    const redeemableTokens = usersAgg?.[0]?.redeemableTokens || 0;
    const nonRedeemableTokens = Math.max(0, circulatingTokens - redeemableTokens);

    const sumTx = async (match, userField = "fromUserId") => {
      const out = await TokenTransaction.aggregate([
        { $match: match },
        {
          $lookup: {
            from: "users",
            localField: userField,
            foreignField: "_id",
            as: "metricUser",
          },
        },
        { $unwind: "$metricUser" },
        { $match: getValidJoinedUserMetricMatch("metricUser", environment) },
        { $group: { _id: null, total: { $sum: "$amountTokens" } } },
      ]);
      return out?.[0]?.total || 0;
    };

    const platformIncomeTokens = await sumTx({
      kind: { $in: ["vip", "adv_slot", "showcase"] },
    });

    const purchasedTokens = await sumTx({
      kind: "purchase",
      direction: "credit",
    }, "toUserId");

    const paidOutTokens = await sumTx({
      kind: "payout",
      direction: "debit",
    });

    return res.json({
      status: "ok",
      data: {
        circulatingTokens,
        redeemableTokens,
        nonRedeemableTokens,
        platformIncomeTokens,
        purchasedTokens,
        paidOutTokens,
        environment,
      },
    });
  } catch (e) {
    console.error("admin economy summary error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// GET /api/admin/economy/native-private-review
router.get("/native-private-review", auth, adminGuard, async (req, res) => {
  try {
    const allowedStatuses = ["held", "frozen"];
    const requestedStatus = String(req.query.status || "").trim().toLowerCase();
    const statusFilter = allowedStatuses.includes(requestedStatus)
      ? requestedStatus
      : { $in: allowedStatuses };

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

    const events = await Event.find({
      accessScope: "private",
      status: "finished",
      "privateSession.economicStatus": statusFilter,
    })
      .sort({
        "privateSession.economicReleaseEligibleAt": 1,
        updatedAt: -1,
      })
      .limit(limit)
      .populate({
        path: "creatorId",
        select: "displayName email accountType isCreator creatorEnabled payoutEnabled payoutStatus",
      })
      .lean();

    const data = events.map((event) => ({
      eventId: event._id,
      title: event.title || "",
      status: event.status,
      creator: event.creatorId
        ? {
            id: event.creatorId._id,
            displayName: event.creatorId.displayName || "",
            email: event.creatorId.email || "",
            accountType: event.creatorId.accountType || null,
            isCreator: event.creatorId.isCreator === true,
            creatorEnabled: event.creatorId.creatorEnabled === true,
            payoutEnabled: event.creatorId.payoutEnabled === true,
            payoutStatus: event.creatorId.payoutStatus || "none",
          }
        : null,
      privateEconomic: {
        status: event.privateSession?.economicStatus || "none",
        heldTokens: Number(event.privateSession?.economicHeldTokens || 0),
        heldAt: event.privateSession?.economicHeldAt || null,
        releaseEligibleAt: event.privateSession?.economicReleaseEligibleAt || null,
        releasedAt: event.privateSession?.economicReleasedAt || null,
        frozenAt: event.privateSession?.economicFrozenAt || null,
        refundedAt: event.privateSession?.economicRefundedAt || null,
        resolutionReason: event.privateSession?.economicResolutionReason || null,
      },
      roomId: event.privateSession?.roomId || null,
      ticketPriceTokens: Number(event.ticketPriceTokens || 0),
      maxSeats: Number(event.maxSeats || 0),
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    }));

    return res.json({
      status: "ok",
      data,
    });
  } catch (e) {
    console.error("admin native private review list error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/admin/economy/native-private/:eventId/freeze
router.post("/native-private/:eventId/freeze", auth, adminGuard, async (req, res) => {
  try {
    const adminId = req.user?._id || null;
    const eventId = req.params.eventId;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_EVENT_ID",
        message: "Invalid event ID",
      });
    }

    const now = new Date();
    const reasonRaw = String(req.body?.reason || "").trim();
    const freezeReason = reasonRaw ? reasonRaw.slice(0, 200) : "ADMIN_FROZEN";

    const beforeEvent = await Event.findById(eventId)
      .populate({
        path: "creatorId",
        select: "_id displayName email",
      })
      .lean();

    if (!beforeEvent) {
      return res.status(404).json({
        status: "error",
        code: "EVENT_NOT_FOUND",
        message: "Event not found",
      });
    }

    const freezeResult = await freezeNativePrivateHeldEvent({
      eventId,
      adminId,
      now,
      reason: freezeReason,
    });

    const frozenEvent = await Event.findById(eventId)
      .populate({
        path: "creatorId",
        select: "_id displayName email",
      })
      .lean();

    if (freezeResult?.processed && !freezeResult?.alreadyFrozen) {
      try {
        const creatorId = frozenEvent?.creatorId?._id || frozenEvent?.creatorId || null;

        if (creatorId) {
          await appendAccountTrustEvent({
            userId: creatorId,
            kind: "private_funds_frozen",
            byAdminId: adminId,
            targetType: "event",
            targetId: frozenEvent?._id || eventId,
            eventId: frozenEvent?._id || eventId,
            note: freezeReason,
            reasonCode: "PRIVATE_FUNDS_FROZEN",
            at: frozenEvent?.privateSession?.economicFrozenAt || now,
          });
        }
      } catch (e) {
        console.error("account trust freeze failed:", e?.message || e);
      }
      try {
        await AdminAuditLog.create({
          adminId,
          actionType: "ADMIN_PRIVATE_FUNDS_FROZEN",
          targetType: "event",
          targetId: String(eventId),
          meta: {
            reason: freezeReason,
            economicStatusBefore: freezeResult?.statusBefore || null,
            economicStatusAfter: freezeResult?.statusAfter || "frozen",
            heldTokens: Number(frozenEvent?.privateSession?.economicHeldTokens || 0),
          },
        });
      } catch (e) {
        console.error("ADMIN_PRIVATE_FUNDS_FROZEN audit failed:", e?.message || e);
      }

      try {
        await ActionAuditLog.create({
          actorId: adminId,
          actorRole: "admin",
          actionType: "ADMIN_PRIVATE_FUNDS_FROZEN",
          targetType: "event",
          targetId: String(eventId),
          reason: freezeReason,
          meta: {
            economicStatusBefore: freezeResult?.statusBefore || null,
            economicStatusAfter: freezeResult?.statusAfter || "frozen",
          },
          ip: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        });
      } catch (e) {
        console.error("ACTION audit freeze failed:", e?.message || e);
      }

      try {
        const creatorId = frozenEvent?.creatorId?._id || frozenEvent?.creatorId || null;

        if (creatorId) {
          await Notification.updateOne(
            { dedupeKey: `private_funds_frozen:creator:${eventId}` },
            {
              $setOnInsert: {
                userId: creatorId,
                actorId: adminId,
                type: "SYSTEM_PRIVATE_FUNDS_FROZEN",
                targetType: "event",
                targetId: frozenEvent._id,
                message: "Funds for a private event have been frozen for admin review",
                isPersistent: true,
                data: {
                  eventId: frozenEvent._id,
                  economicStatus: "frozen",
                  heldTokens: Number(frozenEvent?.privateSession?.economicHeldTokens || 0),
                  reason: freezeReason,
                  frozenAt: frozenEvent?.privateSession?.economicFrozenAt || now,
                },
                dedupeKey: `private_funds_frozen:creator:${eventId}`,
              },
            },
            { upsert: true }
          );
        }
      } catch (e) {
        console.error("freeze creator notification failed:", e?.message || e);
      }

      try {
        const ticketHolders = await require("../models/ticket").distinct("userId", {
          eventId: frozenEvent._id,
          scope: "private",
          roomId: frozenEvent?.privateSession?.roomId || null,
          status: "active",
        });

        if (Array.isArray(ticketHolders) && ticketHolders.length > 0) {
          await Promise.all(
            ticketHolders.map((uid) =>
              Notification.updateOne(
                { dedupeKey: `private_funds_frozen:buyer:${eventId}:${String(uid)}` },
                {
                  $setOnInsert: {
                    userId: uid,
                    actorId: adminId,
                    type: "SYSTEM_PRIVATE_FUNDS_FROZEN",
                    targetType: "event",
                    targetId: frozenEvent._id,
                    message: "Payment for a private event is under admin review",
                    isPersistent: true,
                    data: {
                      eventId: frozenEvent._id,
                      economicStatus: "frozen",
                      reason: freezeReason,
                      frozenAt: frozenEvent?.privateSession?.economicFrozenAt || now,
                    },
                    dedupeKey: `private_funds_frozen:buyer:${eventId}:${String(uid)}`,
                  },
                },
                { upsert: true }
              )
            )
          );
        }
      } catch (e) {
        console.error("freeze buyer notifications failed:", e?.message || e);
      }
    }

    return res.json({
      status: "ok",
      data: {
        eventId: frozenEvent?._id || eventId,
        economicStatus: frozenEvent?.privateSession?.economicStatus || "none",
        heldTokens: Number(frozenEvent?.privateSession?.economicHeldTokens || 0),
        heldAt: frozenEvent?.privateSession?.economicHeldAt || null,
        frozenAt: frozenEvent?.privateSession?.economicFrozenAt || null,
        releaseEligibleAt: frozenEvent?.privateSession?.economicReleaseEligibleAt || null,
        resolutionReason: frozenEvent?.privateSession?.economicResolutionReason || null,
        alreadyFrozen: freezeResult?.alreadyFrozen === true,
      },
    });
  } catch (e) {
    if (e?.httpStatus && e?.payload) {
      return res.status(e.httpStatus).json(e.payload);
    }

    console.error("admin native private freeze error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

// POST /api/admin/economy/native-private/:eventId/refund
router.post("/native-private/:eventId/refund", auth, adminGuard, async (req, res) => {
  try {
    const adminId = req.user?._id || null;
    const eventId = req.params.eventId;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_EVENT_ID",
        message: "Invalid event ID",
      });
    }

    const now = new Date();
    const reasonRaw = String(req.body?.reason || "").trim();
    const refundReason = reasonRaw ? reasonRaw.slice(0, 200) : "ADMIN_REFUND";

    const beforeEvent = await Event.findById(eventId)
      .populate({
        path: "creatorId",
        select: "_id displayName email",
      })
      .lean();

    if (!beforeEvent) {
      return res.status(404).json({
        status: "error",
        code: "EVENT_NOT_FOUND",
        message: "Event not found",
      });
    }

    const refundResult = await refundNativePrivateHeldOrFrozenEvent({
      eventId,
      adminId,
      now,
      reason: refundReason,
    });

    const refundedEvent = await Event.findById(eventId)
      .populate({
        path: "creatorId",
        select: "_id displayName email",
      })
      .lean();

    if (refundResult?.processed && !refundResult?.alreadyRefunded) {
      try {
        const creatorId = refundedEvent?.creatorId?._id || refundedEvent?.creatorId || null;

        if (creatorId) {
          await appendAccountTrustEvent({
            userId: creatorId,
            kind: "private_funds_refunded",
            byAdminId: adminId,
            targetType: "event",
            targetId: refundedEvent?._id || eventId,
            eventId: refundedEvent?._id || eventId,
            note: refundReason,
            reasonCode: "PRIVATE_FUNDS_REFUNDED",
            at: refundedEvent?.privateSession?.economicRefundedAt || now,
          });
        }
      } catch (e) {
        console.error("account trust refund failed:", e?.message || e);
      }
      try {
        await AdminAuditLog.create({
          adminId,
          actionType: "ADMIN_PRIVATE_FUNDS_REFUNDED",
          targetType: "event",
          targetId: String(eventId),
          meta: {
            reason: refundReason,
            economicStatusBefore: refundResult?.statusBefore || null,
            economicStatusAfter: refundResult?.statusAfter || "refunded",
            refundedCount: Number(refundResult?.refundedCount || 0),
            refundedTokens: Number(refundResult?.refundedTokens || 0),
          },
        });
      } catch (e) {
        console.error("ADMIN_PRIVATE_FUNDS_REFUNDED audit failed:", e?.message || e);
      }

      try {
        await ActionAuditLog.create({
          actorId: adminId,
          actorRole: "admin",
          actionType: "ADMIN_PRIVATE_FUNDS_REFUNDED",
          targetType: "event",
          targetId: String(eventId),
          reason: refundReason,
          meta: {
            economicStatusBefore: refundResult?.statusBefore || null,
            economicStatusAfter: refundResult?.statusAfter || "refunded",
            refundedCount: Number(refundResult?.refundedCount || 0),
            refundedTokens: Number(refundResult?.refundedTokens || 0),
          },
          ip: req.ip || null,
          userAgent: req.headers["user-agent"] || null,
        });
      } catch (e) {
        console.error("ACTION audit refund failed:", e?.message || e);
      }

      try {
        const creatorId = refundedEvent?.creatorId?._id || refundedEvent?.creatorId || null;

        if (creatorId) {
          await Notification.updateOne(
            { dedupeKey: `private_funds_refunded:creator:${eventId}` },
            {
              $setOnInsert: {
                userId: creatorId,
                actorId: adminId,
                type: "SYSTEM_PRIVATE_FUNDS_REFUNDED",
                targetType: "event",
                targetId: refundedEvent._id,
                message: "Funds for a private event have been refunded by admin decision",
                isPersistent: true,
                data: {
                  eventId: refundedEvent._id,
                  economicStatus: "refunded",
                  refundedTokens: Number(refundResult?.refundedTokens || 0),
                  reason: refundReason,
                  refundedAt: refundedEvent?.privateSession?.economicRefundedAt || now,
                },
                dedupeKey: `private_funds_refunded:creator:${eventId}`,
              },
            },
            { upsert: true }
          );
        }
      } catch (e) {
        console.error("refund creator notification failed:", e?.message || e);
      }

      try {
        const refundedTickets = await Ticket.find({
          eventId: refundedEvent._id,
          scope: "private",
          roomId: refundedEvent?.privateSession?.roomId || null,
          status: "refunded",
        })
          .select("userId priceTokens _id")
          .lean();

        for (const t of refundedTickets) {
          await Notification.updateOne(
            { dedupeKey: `private_funds_refunded:buyer:${eventId}:${String(t.userId)}` },
            {
              $setOnInsert: {
                userId: t.userId,
                actorId: adminId,
                type: "SYSTEM_PRIVATE_FUNDS_REFUNDED",
                targetType: "event",
                targetId: refundedEvent._id,
                message: "Payment for a private event has been refunded by admin decision",
                isPersistent: true,
                data: {
                  eventId: refundedEvent._id,
                  ticketId: t._id,
                  refundedTokens: Number(t.priceTokens || 0),
                  economicStatus: "refunded",
                  reason: refundReason,
                  refundedAt: refundedEvent?.privateSession?.economicRefundedAt || now,
                },
                dedupeKey: `private_funds_refunded:buyer:${eventId}:${String(t.userId)}`,
              },
            },
            { upsert: true }
          );

          await RefundLog.updateOne(
            {
              type: "manual_refund",
              userId: t.userId,
              referenceType: "event",
              referenceId: String(refundedEvent._id),
              reasonCode: "MANUAL_APPROVED",
            },
            {
              $setOnInsert: {
                type: "manual_refund",
                userId: t.userId,
                amountTokens: Number(t.priceTokens || 0),
                currency: "token",
                reasonCode: "MANUAL_APPROVED",
                referenceType: "event",
                referenceId: String(refundedEvent._id),
                createdByAdminId: adminId,
                resolved: true,
              },
            },
            { upsert: true }
          );
        }
      } catch (e) {
        console.error("refund buyer notifications/logs failed:", e?.message || e);
      }
    }

    return res.json({
      status: "ok",
      data: {
        eventId: refundedEvent?._id || eventId,
        economicStatus: refundedEvent?.privateSession?.economicStatus || "none",
        heldTokens: Number(refundedEvent?.privateSession?.economicHeldTokens || 0),
        heldAt: refundedEvent?.privateSession?.economicHeldAt || null,
        frozenAt: refundedEvent?.privateSession?.economicFrozenAt || null,
        refundedAt: refundedEvent?.privateSession?.economicRefundedAt || null,
        releaseEligibleAt: refundedEvent?.privateSession?.economicReleaseEligibleAt || null,
        resolutionReason: refundedEvent?.privateSession?.economicResolutionReason || null,
        refundedCount: Number(refundResult?.refundedCount || 0),
        refundedTokens: Number(refundResult?.refundedTokens || 0),
        alreadyRefunded: refundResult?.alreadyRefunded === true,
      },
    });
  } catch (e) {
    if (e?.httpStatus && e?.payload) {
      return res.status(e.httpStatus).json(e.payload);
    }

    console.error("admin native private refund error:", e);
    return res.status(500).json({ status: "error", message: "Internal error" });
  }
});

module.exports = router;
