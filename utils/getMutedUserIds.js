// utils/JetMutedUserIds.js
const MutedUser = require("../models/MutedUser");

async function JetMutedUserIds(userId) {
  const rows = await MutedUser.find({ userId }).select("mutedUserId");
  return rows.map((r) => r.mutedUserId);
}

module.exports = JetMutedUserIds;