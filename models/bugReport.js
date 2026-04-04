const mongoose = require("mongoose");

const BugReportSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    category: {
      type: String,
      enum: ["social", "live", "chat", "tokens", "search", "adv", "showcase"],
      required: true,
      index: true,
    },

    text: {
      type: String,
      required: true,
      maxlength: 1000,
    },

    steps: {
      type: String,
      maxlength: 2000,
    },

    screenshotUrl: {
      type: String,
      maxlength: 500,
    },

    route: {
      type: String,
      maxlength: 300,
    },

    userAgent: {
      type: String,
      maxlength: 500,
    },

    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BugReport", BugReportSchema);