const mongoose = require('mongoose');

const { Schema } = mongoose;

const postLikeSchema = new Schema(
    {
        postId: {
            type: Schema.Types.ObjectId,
            ref: 'Post',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// prevent duplicate userId+postId
postLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.PostLike || mongoose.model('PostLike', postLikeSchema);