const mongoose = require("mongoose");

const PlatformUpdateSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 220 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, versionKey: false }
);

PlatformUpdateSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model("PlatformUpdate", PlatformUpdateSchema);