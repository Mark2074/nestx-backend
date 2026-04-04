const mongoose = require("mongoose");

const ageGateLogSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
      unique: true, // 1 log per email
    },

    // Prima DOB inserita in tentativo underage (stringa YYYY-MM-DD)
    firstDobString: { type: String, default: null },

    // Numero tentativi falliti (età < 18)
    failedUnderageAttempts: { type: Number, default: 0 },

    lastUnderageAttemptAt: { type: Date, default: null },

    // DOB usata nella registrazione riuscita (stringa YYYY-MM-DD)
    successDobString: { type: String, default: null },

    // Link all'account finale (se creato)
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    linkedAt: { type: Date, default: null },

    status: {
      type: String,
      enum: ["anonymous", "linked"],
      default: "anonymous",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.models.AgeGateLog || mongoose.model("AgeGateLog", ageGateLogSchema);
