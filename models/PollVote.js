const mongoose = require("mongoose");
const { Schema } = mongoose;

const pollVoteSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: "Post", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    optionIndex: { type: Number, required: true },
  },
  { timestamps: true }
);

// 1 voto per (post,user)
pollVoteSchema.index({ postId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("PollVote", pollVoteSchema);

