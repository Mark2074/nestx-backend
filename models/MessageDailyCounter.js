// models/MessageDailyCounter.js
const mongoose = require("mongoose");

const messageDailyCounterSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // YYYY-MM-DD in timezone Europe/Rome
    dayKey: {
      type: String,
      required: true,
      index: true,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// Un contatore per utente per giorno
messageDailyCounterSchema.index({ userId: 1, dayKey: 1 }, { unique: true });

module.exports = mongoose.model("MessageDailyCounter", messageDailyCounterSchema);
