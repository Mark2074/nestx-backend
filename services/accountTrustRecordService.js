const mongoose = require("mongoose");
const AccountTrustRecord = require("../models/AccountTrustRecord");

const MAX_LAST_EVENTS = 20;

const ALLOWED_KINDS = new Set([
  "report_actioned",
  "post_hidden",
  "private_funds_frozen",
  "private_funds_refunded",
  "creator_disabled",
  "creator_reenabled",
  "manual_refund_approved",
]);

function normalizeObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  if (typeof value === "object" && value._id && mongoose.Types.ObjectId.isValid(value._id)) {
    return new mongoose.Types.ObjectId(value._id);
  }
  return null;
}

function buildTierFromRecord(record) {
  const gravissimo = Number(record?.confirmedGravissimo || 0);
  const grave = Number(record?.confirmedGrave || 0);
  const freezeTotal = Number(record?.creatorFreezeTotal || 0);
  const refundTotal = Number(record?.creatorRefundTotal || 0);
  const disableTotal = Number(record?.creatorDisableTotal || 0);

  const score =
    gravissimo * 5 +
    grave * 2 +
    disableTotal * 3 +
    refundTotal * 2 +
    freezeTotal * 1;

  let tier = "OK";
  if (gravissimo >= 2 || score >= 12) tier = "BLOCCO";
  else if (gravissimo >= 1 || score >= 8 || disableTotal >= 2) tier = "CRITICO";
  else if (grave >= 2 || freezeTotal >= 1 || refundTotal >= 1 || disableTotal >= 1 || score >= 3) tier = "ATTENZIONE";

  return { tier, tierScore: score };
}

async function appendAccountTrustEvent({
  userId,
  kind,
  byAdminId = null,
  reportId = null,
  targetType = "user",
  targetId = null,
  severity = null,
  category = null,
  eventId = null,

  note = null,
  reasonCode = null,

  reportReason = null,
  userMessage = null,
  adminOutcome = null,
  adminNote = null,

  at = new Date(),
}) {
  if (!userId) return null;
  if (!ALLOWED_KINDS.has(kind)) {
    throw new Error(`Unsupported trust event kind: ${kind}`);
  }

  const normalizedUserId = normalizeObjectId(userId);
  if (!normalizedUserId) {
    throw new Error("Invalid userId for AccountTrustRecord");
  }

  const normalizedByAdminId = normalizeObjectId(byAdminId);
  const normalizedReportId = normalizeObjectId(reportId);
  const normalizedTargetId = normalizeObjectId(targetId || userId);
  const normalizedEventId = normalizeObjectId(eventId);

  const baseSetOnInsert = {
    userId: normalizedUserId,
  };

  const eventPayload = {
    kind,
    reportId: normalizedReportId,
    targetType,
    targetId: normalizedTargetId || normalizedUserId,
    severity: severity || null,
    category: category || null,
    eventId: normalizedEventId,

    note: note ? String(note).trim().slice(0, 300) : null,
    reasonCode: reasonCode ? String(reasonCode).trim().slice(0, 100) : null,

    reportReason: reportReason ? String(reportReason).trim().slice(0, 300) : null,
    userMessage: userMessage ? String(userMessage).trim().slice(0, 500) : null,
    adminOutcome: adminOutcome ? String(adminOutcome).trim().slice(0, 100) : null,
    adminNote: adminNote ? String(adminNote).trim().slice(0, 500) : null,

    at: at instanceof Date ? at : new Date(at),
    byAdminId: normalizedByAdminId,
  };

  const inc = {};
  const set = {
    updatedByAdminId: normalizedByAdminId,
  };

  switch (kind) {
    case "private_funds_frozen":
      inc.creatorFreezeTotal = 1;
      set.lastCreatorFreezeAt = eventPayload.at;
      set.creatorFlagged = true;
      break;

    case "private_funds_refunded":
      inc.creatorRefundTotal = 1;
      set.lastCreatorRefundAt = eventPayload.at;
      set.creatorFlagged = true;
      break;

    case "creator_disabled":
      inc.creatorDisableTotal = 1;
      set.lastCreatorDisableAt = eventPayload.at;
      set.creatorFlagged = true;
      break;

    case "creator_reenabled":
      inc.creatorReenableTotal = 1;
      set.lastCreatorReenableAt = eventPayload.at;
      break;

    case "manual_refund_approved":
      inc.manualRefundApprovedTotal = 1;
      set.creatorFlagged = true;
      break;

    case "report_actioned":
      inc.confirmedTotal = 1;
      if (eventPayload.severity === "grave") inc.confirmedGrave = 1;
      if (eventPayload.severity === "gravissimo") inc.confirmedGravissimo = 1;
      set.lastConfirmedAt = eventPayload.at;
      set.lastConfirmedSeverity = eventPayload.severity || null;
      set.lastConfirmedCategory = eventPayload.category || null;
      break;

    case "post_hidden":
      break;

    default:
      break;
  }

  const record = await AccountTrustRecord.findOneAndUpdate(
    { userId: normalizedUserId },
    {
      $setOnInsert: baseSetOnInsert,
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(Object.keys(inc).length ? { $inc: inc } : {}),
      $push: {
        lastEvents: {
          $each: [eventPayload],
          $slice: -MAX_LAST_EVENTS,
        },
      },
    },
    {
      new: true,
      upsert: true,
    }
  );

  const { tier, tierScore } = buildTierFromRecord(record);

  record.tier = tier;
  record.tierScore = tierScore;

  if (note && kind !== "report_actioned" && kind !== "post_hidden") {
    record.creatorReviewNote = String(note).trim().slice(0, 300);
  }

  await record.save();
  return record;
}

module.exports = {
  appendAccountTrustEvent,
  buildTierFromRecord,
};