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
    /** Invite code already saved for this device. Empty when the device never redeemed one. */
    code: { type: String, default: "", index: true },
  },
  { timestamps: true, collection: "beta_feedback" }
);

feedbackSchema.index({ createdAt: -1 });

const signupSchema = new Schema(
  {
    deviceId: { type: String, required: true, unique: true },
    code: { type: String, required: true, index: true },
    accountId: { type: String },
    lastActiveAt: { type: Date },
  },
  { timestamps: true, collection: "beta_signups" }
);

const eventCodeCountSchema = new Schema(
  {
    code: { type: String, required: true },
    count: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const eventSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 0 },
    /** Per-invite-code split. The top-level count stays the total, including events with no code. */
    byCode: { type: [eventCodeCountSchema], default: () => [] },
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
    /** Invite code already saved for this device. Empty when the device never redeemed one. */
    code: { type: String, default: "", index: true },
  },
  { timestamps: true, collection: "beta_client_errors" }
);

export const BetaFeedback = mongoose.model("BetaFeedback", feedbackSchema);
export const BetaSignup = mongoose.model("BetaSignup", signupSchema);
export const BetaEvent = mongoose.model("BetaEvent", eventSchema);
export const BetaClientError = mongoose.model("BetaClientError", clientErrorSchema);
