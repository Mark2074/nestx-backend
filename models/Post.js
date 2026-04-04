const mongoose = require("mongoose");
const { Schema } = mongoose;

const MediaItemSchema = new Schema(
  {
    type: { type: String, enum: ["image", "video"], required: true },
    url: { type: String, required: true },
    thumbUrl: { type: String, default: null },
    durationSec: { type: Number, default: null }, // solo video
  },
  { _id: false }
);

const PollOptionSchema = new Schema(
  {
    text: { type: String, trim: true, maxlength: 80, required: true },
    votesCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const postSchema = new Schema(
  {
    authorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    area: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      index: true,
    },
    language: {
      type: String, // es. "it", "en"
      default: "",
      trim: true,
      lowercase: true,
      index: true,
    },
    // testo (manteniamo il nome "text" per compatibilità)
    text: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },

    // nuovo: media unificato (immagini + video)
    media: {
      type: [MediaItemSchema],
      default: [],
      validate: {
        validator: function (arr) {
          // limite ragionevole: max 6 media totali
          return Array.isArray(arr) && arr.length <= 6;
        },
        message: "A post can have a maximum of 6 media.",
      },
    },

    // nuovo: sondaggio
    poll: {
      question: { type: String, trim: true, maxlength: 200, default: null },
      options: {
        type: [PollOptionSchema],
        default: [],
        validate: {
          validator: function (arr) {
            // se c'è poll.question, options deve essere 2..6
            if (!this.poll || !this.poll.question) return true;
            return Array.isArray(arr) && arr.length >= 2 && arr.length <= 6;
          },
          message: "A poll must have 2 to 6 options.",
        },
      },
      allowMultiple: { type: Boolean, default: false },
      endsAt: { type: Date, default: null },
    },

    // nuovo: location opzionale
    location: {
      name: { type: String, trim: true, maxlength: 120, default: null },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    // nuovo: chi può commentare
    commentPolicy: {
      type: String,
      enum: ["everyone", "followers", "none"],
      default: "everyone",
    },

    tags: {
      type: [String],
      default: [],
    },

    visibility: {
      type: String,
      enum: ["public", "followers"],
      default: "public",
      index: true,
    },

    isHidden: {
      type: Boolean,
      default: false,
      index: true,
    },

    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    // --------------------------------------------------
    // MODERAZIONE (static content)
    // --------------------------------------------------
    moderation: {
      status: { type: String, enum: ["visible", "under_review", "hidden"], default: "visible", index: true },
      hiddenBy: { type: String, enum: ["ai", "admin"], default: null, index: true },
      hiddenReason: { type: String, default: null },            // testo breve per admin
      hiddenSeverity: { type: String, enum: ["grave", "gravissimo"], default: null, index: true },
      hiddenCategory: { type: String, default: null, trim: true, lowercase: true, index: true },
      hiddenAt: { type: Date, default: null, index: true },
      hiddenByAdminId: { type: Schema.Types.ObjectId, ref: "User", default: null },

      // --------------------------------------------------
      // SOFT DELETE (LEGAL TRACE)
      // --------------------------------------------------
      isDeleted: { type: Boolean, default: false, index: true },
      deletedAt: { type: Date, default: null, index: true },
      deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
      deletedByRole: { type: String, enum: ["owner", "admin"], default: null, index: true },
      deleteReason: { type: String, default: null }, // "user_delete" | "admin_action" | "legal"

      // opzionale ma utile per IA: snapshot flag
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
    
  },
  { timestamps: true }
  
);

// =========================
// INDEXES (FASE 1 - FEED HOT PATH)
// =========================
postSchema.index({ createdAt: -1 });
postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ visibility: 1, createdAt: -1 });
postSchema.index({ "moderation.isDeleted": 1, createdAt: -1 });

module.exports = mongoose.model("Post", postSchema);
