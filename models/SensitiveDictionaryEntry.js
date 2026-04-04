const mongoose = require("mongoose");

const SensitiveDictionaryEntrySchema = new mongoose.Schema(
  {
    // es: "y17", "ir16", "teen", "father daughter"
    pattern: { type: String, required: true, trim: true, lowercase: true },

    // "regex" permette pattern avanzati, "plain" = contains
    matchType: { type: String, enum: ["plain", "regex"], default: "plain", index: true },

    // gravità associata al match (per log / priorità)
    severity: { type: String, enum: ["grave", "gravissimo"], default: "grave", index: true },

    // categoria custom per recidiva (es: "minori", "incesto", "ageplay")
    category: { type: String, default: null, trim: true, lowercase: true, index: true },

    // attivo/disattivo senza cancellare
    isActive: { type: Boolean, default: true, index: true },

    // note admin
    note: { type: String, default: null },

    updatedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "sensitive_dictionary" }
);

// evita duplicati sul pattern (case-insensitive grazie a lowercase)
SensitiveDictionaryEntrySchema.index({ pattern: 1 }, { unique: true });

module.exports = mongoose.model("SensitiveDictionaryEntry", SensitiveDictionaryEntrySchema);
