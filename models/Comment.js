const mongoose = require('mongoose');

const { Schema } = mongoose;

const commentSchema = new Schema(
  {
    postId: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },

    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    deletedByRole: { type: String, enum: ["admin", "vip", "owner"], default: null },

    moderation: {
      status: { type: String, enum: ["visible", "under_review", "hidden"], default: "visible", index: true },
      hiddenBy: { type: String, enum: ["ai", "admin", "system"], default: null, index: true },
      hiddenReason: { type: String, default: null },
      hiddenSeverity: { type: String, enum: ["grave", "gravissimo"], default: null, index: true },
      hiddenCategory: { type: String, default: null, trim: true, lowercase: true, index: true },
      hiddenAt: { type: Date, default: null, index: true },
      hiddenByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      ai: {
        flagged: { type: Boolean, default: false, index: true },
        score: { type: Number, default: 0 },
        labels: { type: [String], default: [] },
        reason: { type: String, default: null },
        provider: { type: String, default: null },
        model: { type: String, default: null },
        reviewedAt: { type: Date, default: null },
      },
    },

    // ======================
    // REPLY SUPPORT
    // ======================
    parentCommentId: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true,
    },

    isReply: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Comment', commentSchema);