require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/user");

function getMongoUri() {
  return (
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL ||
    process.env.MONGO_URL ||
    null
  );
}

async function run() {
  try {
    const uri = getMongoUri();
    if (!uri) {
      console.error("❌ Missing MongoDB connection string in env.");
      console.error("Tried: MONGO_URI, MONGODB_URI, DATABASE_URL, MONGO_URL");
      process.exit(1);
    }

    console.log("🔄 Connecting to Mongo...");
    await mongoose.connect(uri);

    console.log("🔎 Finding users without creatorVerification...");

    const result = await User.updateMany(
      { creatorVerification: { $exists: false } },
      {
        $set: {
          creatorVerification: {
            status: "none",
            declaredOver18: false,
            submittedAt: null,
            verifiedAt: null,
            verifiedByAdminId: null,
            rejectedAt: null,
            rejectedByAdminId: null,
            rejectionReason: null,
          },
        },
      }
    );

    console.log("✅ Backfill complete.");
    console.log("Matched:", result.matchedCount);
    console.log("Modified:", result.modifiedCount);

    await mongoose.disconnect();
    console.log("🔌 Disconnected.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error during backfill:", err);
    process.exit(1);
  }
}

run();