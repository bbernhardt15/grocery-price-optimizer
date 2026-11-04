import mongoose, { Schema } from "mongoose";

const contextSchema = new Schema(
  {
    appVersion: { type: String, default: "" },
    shellCache: { type: String, default: "" },
    screen: { type: String, default: "" },
    tab: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    tripItemCount: { type: Number, default: 0 },
    storeCount: { type: Number, default: 0 },
    timestamp: { type: String, default: "" },
  },
  { _id: false }
);

const feedbackSchema = new Schema(
  {
    rating: { type: Number, required: true, min: 1, max: 5 },
    message: { type: String, default: "" },
    screen: { type: String, default: "" },
    context: { type: contextSchema, default: () => ({}) },
    deviceId: { type: String, required: true, index: true },
    accountId: { type: String },
  },
  { timestamps: true, collection: "beta_feedback" }
);

feedbackSchema.index({ createdAt: -1 });

const signupSchema = new Schema(
  {
    deviceId: { type: String, required: true, unique: true },
    code: { type: String, required: true, index: true },
    accountId: { type: String },
  },
  { timestamps: true, collection: "beta_signups" }
);

const eventSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, collection: "beta_events" }
);

const clientErrorSchema = new Schema(
  {
    message: { type: String, required: true },
    stack: { type: String, default: "" },
    screen: { type: String, default: "" },
    tab: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    deviceId: { type: String, index: true },
  },
  { timestamps: true, collection: "beta_client_errors" }
);

export const BetaFeedback = mongoose.model("BetaFeedback", feedbackSchema);
export const BetaSignup = mongoose.model("BetaSignup", signupSchema);
export const BetaEvent = mongoose.model("BetaEvent", eventSchema);
export const BetaClientError = mongoose.model("BetaClientError", clientErrorSchema);
