require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  try {
    const uri =
      process.env.MONGO_URI ||
      process.env.MONGODB_URI ||
      process.env.DATABASE_URL ||
      process.env.ATLAS_URI;

    if (!uri) {
      throw new Error("Missing MongoDB URI in environment variables");
    }

    await mongoose.connect(uri);
    const info = await mongoose.connection.db.admin().serverInfo();
    console.log("MongoDB version:", info.version);

    await mongoose.disconnect();
    process.exit(0);
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
})();