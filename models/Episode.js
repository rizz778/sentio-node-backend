import mongoose from "mongoose";

const episodeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      index: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      default: null,
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        "conflict",
        "milestone",
        "anxiety_spike",
        "breakthrough",
        "daily_stressor",
        "general",
      ],
      default: "general",
    },
    eventSummary: {
      type: String,
      required: [true, "Event summary is required"],
      trim: true,
      maxlength: [1000, "Event summary cannot exceed 1000 characters"],
    },
    dominantEmotions: {
      type: [String],
      default: [],
    },
    peakDistressScore: {
      type: Number,
      min: 0,
      max: 10,
      default: 0,
    },
    peopleMentioned: {
      type: [String],
      default: [],
    },
    copingAttempted: {
      type: String,
      default: "",
      trim: true,
    },
    resolutionStatus: {
      type: String,
      enum: ["unresolved", "resolved", "ongoing"],
      default: "unresolved",
      index: true,
    },
    embedding: {
      type: [Number],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient per-user queries
episodeSchema.index({ user: 1, resolutionStatus: 1, timestamp: -1 });
episodeSchema.index({ user: 1, timestamp: -1 });

const Episode = mongoose.model("Episode", episodeSchema);

export default Episode;
