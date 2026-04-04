/**
 * Migrazione: images/video -> media[]
 * Esegue una sola volta.
 *
 * Run: node scripts/migrate_posts_media.js
 */
require("dotenv").config();
const mongoose = require("mongoose");

// IMPORTANT: usa il path reale del tuo model
const Post = require("../models/Post");

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGO_URI (o MONGODB_URI) mancante in .env");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log("✅ Connesso a MongoDB");

  // Prendiamo i post dove media non esiste o è vuoto
  const query = {
    $or: [{ media: { $exists: false } }, { media: { $size: 0 } }],
  };

  const cursor = Post.find(query).cursor();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  for await (const post of cursor) {
    scanned++;

    const images = Array.isArray(post.images) ? post.images : [];
    const video = post.video ? String(post.video) : null;

    const newMedia = [];

    for (const url of images) {
      if (url && typeof url === "string") newMedia.push({ type: "image", url });
    }

    if (video) {
      newMedia.push({ type: "video", url: video });
    }

    if (newMedia.length === 0) {
      skipped++;
      continue;
    }

    post.media = newMedia;

    // facoltativo: se vuoi pulire legacy una volta migrato, scommenta:
    // post.images = [];
    // post.video = null;

    await post.save();
    updated++;
  }

  console.log("---- MIGRATION DONE ----");
  console.log({ scanned, updated, skipped });

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Migration error:", err);
  process.exit(1);
});
