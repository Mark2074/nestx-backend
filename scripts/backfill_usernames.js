require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/user");
const {
  normalizeUsername,
  validateUsername,
  usernameBaseFromDisplayName,
} = require("../utils/username");

function mongoUri() {
  return (
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.DATABASE_URL ||
    process.env.MONGO_URL ||
    ""
  );
}

function makeCandidate(base, suffix) {
  const tail = suffix ? `_${suffix}` : "";
  return `${base.slice(0, 30 - tail.length)}${tail}`;
}

function fallbackBase(userId) {
  return `user_${String(userId).slice(-8)}`;
}

function pickUsername(user, used) {
  const initialBase =
    usernameBaseFromDisplayName(user.displayName) || fallbackBase(user._id);

  let base = initialBase;
  if (!validateUsername(base).ok) {
    base = fallbackBase(user._id);
  }

  for (let i = 0; i < 1000; i += 1) {
    const candidate = normalizeUsername(makeCandidate(base, i === 0 ? "" : i + 1));
    const validation = validateUsername(candidate);

    if (validation.ok && !used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }

  const hardFallback = fallbackBase(user._id);
  used.add(hardFallback);
  return hardFallback;
}

async function main() {
  const uri = mongoUri();
  const apply = process.argv.includes("--apply");

  if (!uri) {
    throw new Error("Missing MONGODB_URI / MONGO_URI / DATABASE_URL / MONGO_URL");
  }

  await mongoose.connect(uri);

  try {
    const existing = await User.find({
      username: { $type: "string", $ne: "" },
    })
      .select("_id username")
      .lean();

    const used = new Set(
      existing
        .map((user) => normalizeUsername(user.username))
        .filter((username) => validateUsername(username).ok),
    );

    const missing = await User.find({
      $or: [
        { username: { $exists: false } },
        { username: null },
        { username: "" },
      ],
    })
      .select("_id displayName email username")
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
    console.log(`Users missing username: ${missing.length}`);

    let updated = 0;
    for (const user of missing) {
      const username = pickUsername(user, used);
      console.log(`${user._id} ${user.email || ""} -> ${username}`);

      if (!apply) continue;

      const result = await User.updateOne(
        {
          _id: user._id,
          $or: [
            { username: { $exists: false } },
            { username: null },
            { username: "" },
          ],
        },
        { $set: { username } },
      );

      if (result.modifiedCount > 0) updated += 1;
    }

    console.log(`Updated users: ${updated}`);
    if (!apply) {
      console.log("Dry run only. Re-run with --apply to write usernames.");
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error("BACKFILL_USERNAMES_FAILED:", err);
    try {
      await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
  });
}

module.exports = { main };
