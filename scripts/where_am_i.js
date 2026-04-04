require("dotenv").config();
const mongoose = require("mongoose");

// cambia SOLO questi due require se serve
const Post = require("../models/Post");       // deve essere il model dei post
const LiveRoom = require("../models/LiveRoom"); // se esiste, giusto per confronto

async function main() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  await mongoose.connect(mongoUri);

  const dbName = mongoose.connection.db.databaseName;
  console.log("DB:", dbName);

  console.log("Post model collection:", Post.collection.name);
  console.log("LiveRoom model collection:", LiveRoom?.collection?.name);

  const postCount = await Post.countDocuments({});
  console.log("Post count:", postCount);

  // stampa le prime 30 collection nel DB, così vedi se esistono posts/POSTS
  const cols = await mongoose.connection.db.listCollections().toArray();
  console.log("Collections:", cols.map(c => c.name).sort().slice(0, 30));

  await mongoose.disconnect();
}

main().catch(console.error);
