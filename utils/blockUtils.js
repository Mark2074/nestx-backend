const Block = require("../models/block");

/**
 * Ritorna true se esiste un blocco in QUALSIASI direzione
 * tra userA e userB.
 */
async function isUserBlockedEitherSide(userIdA, userIdB) {
  if (!userIdA || !userIdB) return false;

  const existing = await Block.exists({
    $or: [
      { blockerId: userIdA, blockedId: userIdB },
      { blockerId: userIdB, blockedId: userIdA },
    ],
  });

  return !!existing;
}

/**
 * Ritorna ARRAY di userId (string) che sono bloccati
 * in QUALSIASI direzione con meId:
 * - io blocco loro
 * - loro bloccano me
 */
async function getBlockedUserIds(meId) {
  if (!meId) return [];

  const rows = await Block.find({
    $or: [{ blockerId: meId }, { blockedId: meId }],
  })
    .select("blockerId blockedId")
    .lean();

  const out = new Set();
  for (const r of rows) {
    const blocker = String(r.blockerId);
    const blocked = String(r.blockedId);

    if (blocker === String(meId)) out.add(blocked); // io -> loro
    if (blocked === String(meId)) out.add(blocker); // loro -> me
  }

  out.delete(String(meId));
  return Array.from(out);
}

module.exports = {
  isUserBlockedEitherSide,
  getBlockedUserIds,
};
