const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    tokenVersion: { type: Number, default: 0 },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    // --- AGE GATE / MINORI ---
    dateOfBirth: {
      type: Date,
      required: false, // sarà obbligatoria via register validation; qui la lasciamo false per non rompere utenti già creati
      default: null,
    },
    adultConsentAt: {
      type: Date,
      default: null, // quando accetta il modal 18+
    },

    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpiresAt: { type: Date, default: null },

    emailVerifiedAt: { type: Date, default: null, index: true },
    emailVerifyTokenHash: { type: String, default: null, index: true },
    emailVerifyExpiresAt: { type: Date, default: null },
    
    verificationTotemStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
      index: true,
    },
    profileType: {
      type: String,
      enum: ["male", "female", "couple", "gay", "trans"],
      default: "male", // o "female", o null/undefined se preferisci forzare la scelta in fase di registrazione
    },

    // 🔹 Area geografica (es: "Italia - Puglia", "France - Paris")
    area: {
      type: String,
      default: '',
      trim: true,
    },

    // 🔹 Bio descrittiva
    bio: {
      type: String,
      default: '',
      maxlength: 500,
    },

    // 🔹 Interessi (lista di parole chiave)
    interests: {
      type: [String],
      default: [],
    },

    // 🔹 Lingua (solo per uso interno, non visibile nel profilo a schermo)
    language: {
      type: String,
      default: '',
    },

    // Avatar
    avatar: { 
      type: String,
      default: null 
    },

    // Immagine di copertina
    coverImage: {
      type: String,
      default: null,
    },
    isVip: { type: Boolean, default: false },

    vipExpiresAt: { type: Date, default: null },
    vipAutoRenew: { type: Boolean, default: false },
    vipSince: { type: Date, default: null },
    isCreator: {
      type: Boolean,
      default: false,
    },
    creatorVerification: {
      status: {
        type: String,
        enum: ["none", "pending", "approved", "rejected"],
        default: "none",
        index: true,
      },

      documentUrl: { type: String, default: null },           // R2 key
      selfieWithDocumentUrl: { type: String, default: null }, // R2 key
      videoDeclarationUrl: { type: String, default: null },   // R2 key

      declaredOver18: { type: Boolean, default: false },

      acceptedCreatorTermsVersion: { type: String, default: null },
      acceptedCreatorTermsAt: { type: Date, default: null },
      acceptedFromIp: { type: String, default: null },

      submittedAt: { type: Date, default: null },

      verifiedAt: { type: Date, default: null },
      verifiedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

      rejectedAt: { type: Date, default: null },
      rejectedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      rejectionReason: { type: String, default: null },
      note: { type: String, default: null },
      declaredOver18At: { type: Date, default: null },
    },

    // --- UI CONSENT / INFO FLAGS ---
    hasSeenTokenInfo: {
      type: Boolean,
      default: false,
    },

    // --- ACCOUNT DELETION (GDPR purge flow) ---
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null, index: true },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    // --- Stripe/NestX Creator flags (kill switch + eligibility) ---
    creatorEligible: { type: Boolean, default: false },  // deriva da Stripe webhook
    creatorEnabled: { type: Boolean, default: true },    // kill switch tuo
    creatorDisabledReason: { type: String, default: null },
    creatorDisabledAt: { type: Date, default: null },

    payoutProvider: {
      type: String,
      enum: ["none", "stripe"],   // per ora "none" o "stripe"
      default: "none",
    },
    payoutAccountId: {
      type: String,
      default: null,              // es: account_id di Stripe
    },
    payoutEnabled: {
      type: Boolean,
      default: false,             // true solo quando il provider conferma che può ricevere soldi
    },
    payoutStatus: {
      type: String,
      enum: ["none", "pending", "verified", "disabled"],
      default: "none",
    },
    
    verifiedUser: {
      type: Boolean,
      default: false,
    },

    verificationStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
    },

    verificationPublicVideoUrl: {
      type: String,   // video col foglio, visibile sul profilo
      default: null,
    },

    verificationTotemVideoUrl: {
      type: String,   // video privato col totem
      default: null,
    },

    verificationTotemDescription: {
      type: String,   // breve descrizione del totem (“quadro blu dietro il letto”)
      default: null,
    },

    isPrivate: { type: Boolean, default: false, index: true }, // se true, il profilo non appare nelle liste pubbliche

    // --- CAMPi PER TIPO ACCOUNT / VIP / CREATOR ---
    accountType: {
    type: String,
    enum: ["base", "creator", "admin"],
    default: "base",
    },

    // --- INTERESSI PER FEDBASE ---
    interestsBase: {
      type: [String],
      default: [],
    },

    // --- INTERESSI PER FEDVIP (scritti a mano dai VIP) ---
    interestsVip: {
      type: [String],
      default: [],
    },

    // --- UTENTI CHE SEGUE (per feed "Seguiti") ---
    followingIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],

    // --- Conteggio follower ---
    followerCount: {
      type: Number,
      default: 0,
    },

    // --- Conteggio following ---
    followingCount: {
      type: Number,
      default: 0,
    },

    // --- LOCALIZZAZIONE DI BASE (per filtri futuri) ---
    location: {
      country: { type: String, default: null },
      region: { type: String, default: null },
      city: { type: String, default: null },
    },

    // --- LINGUE PARLATE (es. ["it","en"]) ---
    languages: {
      type: [String],
      default: [],
    },

      // --- SEZIONE TOKEN / MONETIZZAZIONE ---

    // Gross token balance.
    // Invariant:
    // tokenBalance = tokenPurchased + tokenEarnings + tokenRedeemable + tokenHeld
    tokenBalance: {
      type: Number,
      min: 0,
      default: 0,
    },

    // Purchased/topup tokens (spendable, never redeemable)
    tokenPurchased: {
      type: Number,
      min: 0,
      default: 0,
    },

    // Received tokens for non-redeemable users (spendable, not withdrawable)
    tokenEarnings: {
      type: Number,
      min: 0,
      default: 0,
    },

    // Creator withdrawable bucket (also spendable if user decides to spend them)
    tokenRedeemable: {
      type: Number,
      min: 0,
      default: 0,
    },

    // Reserved tokens (showcase hold, payout hold, future compliance hold)
    tokenHeld: {
      type: Number,
      min: 0,
      default: 0,
    },

    tokenInfoAcceptedAt: {
      type: Date,
      default: null,
    },

    tokenInfoAcceptedVersion: {
      type: Number,
      default: null,
    },

    // Blocca Utente
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      }
    ],

    // --- APP SETTINGS (UI + Contesto contenuti) ---
    appSettings: {
      theme: {
        type: String,
        enum: ["light", "dark", "system"],
        default: "system",
      },
      uiLanguage: {
        type: String,
        default: "it",
        trim: true,
      },
      timeFormat: {
        type: String,
        enum: ["24h", "12h"],
        default: "24h",
      },
      contentContext: {
        type: String,
        enum: ["standard", "neutral", "live_events"],
        default: "standard",
      },
    },

    // --- BAN MANUALE (solo admin) ---
    isBanned: { type: Boolean, default: false, index: true },
    bannedAt: { type: Date, default: null },
    banReason: { type: String, default: null },
    bannedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // --- SUSPEND MANUALE (solo admin) ---
    isSuspended: { type: Boolean, default: false, index: true },
    suspendedUntil: { type: Date, default: null, index: true },
    suspendReason: { type: String, default: null },
    suspendedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    versionKey: false,
  }
);

const User = mongoose.model('User', userSchema);
module.exports = User;
