// models/event.js

const mongoose = require("mongoose");

const EventSchema = new mongoose.Schema(
  {
    // 🔹 Chi ha creato l'evento (solo creator)
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    area: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      index: true,
    },
    targetProfileType: {
      type: String, // es. "single" | "coppia" | "gay" | "trans"
      default: "",
      trim: true,
      lowercase: true,
      index: true,
    },
    contentScope: {
      type: String,
      enum: ["HOT", "NO_HOT"],
      required: true,        // obbligatorio
      // NESSUN default (come da concept)
      index: true,
    },
    // 🔹 Contenuto base
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    language: {
      type: String,     // es. "it", "en", "es"
      default: "it",
      trim: true,
    },
    coverImage: {
      type: String, // URL o path relativo
    },
    
    // 🔹 Pianificazione dichiarata
    startTime: {
      type: Date,
      required: true,
    },
    durationMinutes: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    // Possiamo usare questi in futuro per controlli
    plannedStartTime: {
      type: Date,
    },
    plannedDurationMinutes: {
      type: Number,
    },
    plannedInteractionMode: {
      type: String,
      enum: ["broadcast", "interactive"],
    },

    // 🔹 Prezzo & capienza
    ticketPriceTokens: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    maxSeats: {
      type: Number,
      min: 0,
      default: 0,
      // obbligatorio SOLO se l'evento è a pagamento
      required: function () {
        return this.ticketPriceTokens > 0;
      },
    },

    // 🔹 Accesso & interazione
    visibility: {
      type: String,
      enum: ["public", "followers", "unlisted"],
      default: "public",
    },

    // broadcast = show passivo, interactive = chat utenti attiva
    interactionMode: {
      type: String,
      enum: ["broadcast", "interactive"],
      required: true,
      default: "broadcast",
    },

    // Derivato da interactionMode, ma lo teniamo esplicito
    chatEnabledForViewers: {
      type: Boolean,
      default: false,
    },

    // 🔹 TIP totals (host-only in payload)
    tipTotalTokens: { type: Number, default: 0, min: 0 },

    // 🔹 GOAL (progress grows ONLY via tips)
    goal: {
      isActive: { type: Boolean, default: false },
      targetTokens: { type: Number, default: 0, min: 0 },
      progressTokens: { type: Number, default: 0, min: 0 },
      title: { type: String, default: "", trim: true, maxlength: 80 },
      description: { type: String, default: "", trim: true, maxlength: 140 },
      reachedAt: { type: Date, default: null },
      createdAt: { type: Date, default: null },
      updatedAt: { type: Date, default: null },
    },

    // 🔹 Stato evento
    status: {
      type: String,
      enum: ["scheduled", "live", "finished", "cancelled"],
      default: "scheduled",
    },
    startedAt: {
      type: Date
    },
    endedAt: {
      type: Date
    },
    cancelReason: {
      type: String,
    },
    autoCancelled: {
      type: Boolean,
      default: false,
    },

    // 🔹 Runtime (quando è successo davvero)
    actualLiveStartTime: {
      type: Date,
    },
    actualLiveEndTime: {
      type: Date,
    },

    // 🔹 Partecipazione & ticket
    ticketHolders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    ticketsSoldCount: {
      type: Number,
      default: 0,
    },
    viewerCount: { type: Number, default: 0 },
    likesCount: {
      type: Number,
      default: 0,
    },
    likedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
        soldOutInterestCount: {
      type: Number,
      default: 0,
    },
    attendedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    attendedCount: {
      type: Number,
      default: 0,
    },

    // 🔹 Monetizzazione
    totalTokensEarned: {
      type: Number,
      default: 0,
    },
    creatorShareTokens: {
      type: Number,
      default: 0,
    },
    platformShareTokens: {
      type: Number,
      default: 0,
    },

    // 🔹 Ponte con modulo live
    roomId: {
      type: String,
    },

    // 🔹 Sessione Privata
    privateSessionCounter: { type: Number, default: 0, min: 0 },

    privateSession: {
      roomId: { type: String, default: null },
      meetingId: { type: String, default: null },
      provider: { type: String, default: "cloudflare" },
      hostParticipantId: { type: String, default: null },
      hostParticipantName: { type: String, default: null },
      hostPresetName: { type: String, default: null },
      hostRealtimeState: {
        type: String,
        enum: ["idle", "setup", "joined", "broadcasting", "ended"],
        default: "idle",
      },
      hostJoinedAt: { type: Date, default: null },
      hostBroadcastStartedAt: { type: Date, default: null },
      hostLastTokenIssuedAt: { type: Date, default: null },
      isEnabled: { type: Boolean, default: false },
      status: {
        type: String,
        enum: ["idle", "scheduled", "reserved", "running", "completed", "cancelled"],
        default: "idle",
      },
      seats: { type: Number, default: 0, min: 0 },
      ticketPriceTokens: { type: Number, default: 0, min: 0 },
      countdownSeconds: { type: Number, default: 30, min: 0, max: 600 },
      scheduledAt: { type: Date },
      startedAt: { type: Date },

      // ✅ NEW (serve per flow “Buy & Join Private”)
      description: { type: String, default: "", trim: true },
      audioEnabled: { type: Boolean, default: false },
      durationSeconds: { type: Number, default: 0, min: 0, max: 60 * 60 }, // 0 = libero

      reservedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      reservedAt: { type: Date, default: null },
      reservedExpiresAt: { type: Date, default: null }, // TTL lato BE
      startedExpiresAt: { type: Date, default: null },  // auto-close
      lastError: { type: String, default: null },
      acceptedAt: { type: Date, default: null },
      reservedPriceTokens: { type: Number, default: null, min: 0 },
      reservedDescription: { type: String, default: "", trim: true },

      economicStatus: {
        type: String,
        enum: ["none", "held", "released", "frozen", "refunded"],
        default: "none",
      },
      economicHeldTokens: { type: Number, default: 0, min: 0 },
      economicHeldAt: { type: Date, default: null },
      economicReleasedAt: { type: Date, default: null },
      economicFrozenAt: { type: Date, default: null },
      economicRefundedAt: { type: Date, default: null },
      economicResolutionReason: { type: String, default: null },
      economicReleaseEligibleAt: { type: Date, default: null },
    },

    accessScope: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },

    // 🔹 Metadati Live Room
    live: {
      roomId: {
        type: String,
        default: null,
      },
      meetingId: {
        type: String,
        default: null,
      },
      provider: {
        type: String,
        default: "cloudflare",
      },
      hostParticipantId: {
        type: String,
        default: null,
      },
      hostParticipantName: {
        type: String,
        default: null,
      },
      hostPresetName: {
        type: String,
        default: null,
      },
      hostRealtimeState: {
        type: String,
        enum: ["idle", "setup", "joined", "broadcasting", "ended"],
        default: "idle",
      },
      hostJoinedAt: {
        type: Date,
        default: null,
      },
      hostBroadcastStartedAt: {
        type: Date,
        default: null,
      },
      hostLastTokenIssuedAt: {
        type: Date,
        default: null,
      },
      streamKey: {
        type: String,
        default: null,
      },
      playbackUrl: {
        type: String,
        default: null,
      },
      hostMediaStatus: {
        type: String,
        enum: ["idle", "preview", "live", "paused"],
        default: "idle",
      },
      hostMediaSignature: {
        type: String,
        default: null,
      },
      hostMediaSignatureChangedAt: {
        type: Date,
        default: null,
      },
      hostMediaCheckedAt: {
        type: Date,
        default: null,
      },
      hostDisconnectState: {
        type: String,
        enum: ["offline", "online", "grace"],
        default: "offline",
      },
      hostDisconnectGraceStartedAt: {
        type: Date,
        default: null,
      },
      hostDisconnectGraceExpiresAt: {
        type: Date,
        default: null,
      },
      autoFinishReason: {
        type: String,
        default: null,
      },
      startedAt: {
        type: Date,
        default: null,
      },
      endedAt: {
        type: Date,
        default: null,
      },
      allowEarlyJoinMinutes: {
        type: Number,
        default: 10,
        min: 0,
        max: 120,
      },
      chatEnabledForViewers: {
        type: Boolean,
        default: false,
      },
    },
    
    mutedUserIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },

    // 🔹 Flag violazioni qualità
    violationFlags: {
      noShow: { type: Boolean, default: false },
      lateStart: { type: Boolean, default: false },
      earlyEnd: { type: Boolean, default: false },
      chatPromiseBroken: { type: Boolean, default: false },
    },
    // 🔹 Contest (ampliamento futuro)
    contest: {
      isContest: { type: Boolean, default: false },
      type: { type: String, default: null },
      votingMode: { type: String, enum: ["none","free","token"], default: "none" },
      entryFeeTokens: { type: Number, default: 0, min: 0 },
    },

    // Elenco dei partecipanti al contest (PER FUTURO, ora sarà sempre [] vuoto)
    performers: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      displayName: { type: String, default: null },
      order: { type: Number, default: 0 },
      title: { type: String, default: null },
      isConfirmed: { type: Boolean, default: false },
      totalVotes: { type: Number, default: 0 },
      totalTokenVotes: { type: Number, default: 0 },
    }],
    // --- Profile promo (timeline placement) ---
    profilePromoEnabled: { type: Boolean, default: false },
    profilePromoPublishedAt: { type: Date, default: null }, // “pubblicato nel profilo/following”
    profilePromoLeadHours: { type: Number, default: 2, min: 0, max: 48 }, // opzionale ma utile
    
  },
  {
    timestamps: true,
  }
);

// =========================
// INDEXES (FASE 1 - EVENTS FEED HOT PATH)
// =========================
EventSchema.index({
  accessScope: 1,
  status: 1,
  "privateSession.economicStatus": 1,
  "privateSession.economicReleaseEligibleAt": 1,
});

module.exports = mongoose.model("Event", EventSchema);
