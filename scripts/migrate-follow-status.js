require("dotenv").config();
const mongoose = require("mongoose");
const FOLLOW = require("../models/Follow");

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI)

    const res = await FOLLOW.updateMany(
      { status: { $exists: false } },
      { $set: { status: "accepted", acceptedAt: new Date() } }
    );

    console.log("Migration done:", res);
  } catch (e) {
    console.error("Migration error:", e);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
})();
