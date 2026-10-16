import mongoose, { Schema } from "mongoose";

const watchItemSchema = new Schema(
  {
    productId: { type: String, required: true },
    productKey: { type: String, required: true },
    name: { type: String, required: true },
    brand: { type: String, default: "" },
    watch: { type: String, enum: ["inherit", "on", "off"], default: "inherit" },
    baselinePrice: { type: Number, required: true },
    baselineStore: { type: String, default: "" },
    targetPrice: { type: Number },
  },
  { _id: false }
);

const priceWatchSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    listId: { type: String, required: true },
    listName: { type: String, required: true },
    zip: { type: String, default: "" },
    enabled: { type: Boolean, default: false },
    items: { type: [watchItemSchema], default: [] },
  },
  { timestamps: true }
);

priceWatchSchema.index({ deviceId: 1, listId: 1 }, { unique: true });

const priceAlertSchema = new Schema(
  {
    deviceId: { type: String, required: true, index: true },
    listId: { type: String, required: true },
    listName: { type: String, required: true },
    productId: { type: String, required: true },
    productKey: { type: String, required: true },
    itemName: { type: String, required: true },
    storeName: { type: String, required: true },
    oldPrice: { type: Number, required: true },
    newPrice: { type: Number, required: true },
    savings: { type: Number, required: true },
    baselinePrice: { type: Number, required: true },
    targetPrice: { type: Number },
    hitTarget: { type: Boolean, default: false },
    reason: { type: String, enum: ["saved", "target", "both"], required: true },
    /** Same saved price and same new price never insert twice. */
    dropKey: { type: String, required: true, unique: true },
    seenAt: { type: Date, default: null },
    /**
     * pending: a push channel may still deliver this.
     * sent: at least one channel accepted it.
     * skipped: nothing is subscribed, or every subscription is gone.
     * failed: a send was attempted and failed; retried a few times.
     */
    pushState: { type: String, enum: ["pending", "sent", "skipped", "failed"], default: "pending" },
    pushAttempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

priceAlertSchema.index({ deviceId: 1, createdAt: -1 });
priceAlertSchema.index({ deviceId: 1, seenAt: 1 });
priceAlertSchema.index({ pushState: 1, createdAt: 1 });

/**
 * One row per browser or, later, per native device token.
 * `channel: "native"` is stored for a future Capacitor / APNs / FCM transport.
 * Nothing sends on that channel until a transport is registered.
 */
const pushSubscriptionSchema = new Schema(
  {
    deviceId: { type: String, required: true, index: true },
    channel: { type: String, enum: ["web", "native"], required: true },
    endpoint: { type: String },
    p256dh: { type: String },
    auth: { type: String },
    nativeToken: { type: String },
    platform: { type: String, enum: ["web", "ios", "android"] },
  },
  { timestamps: true }
);

pushSubscriptionSchema.index(
  { endpoint: 1 },
  { unique: true, partialFilterExpression: { endpoint: { $type: "string" } } }
);

export type ItemWatchMode = "inherit" | "on" | "off";

export type PriceWatchItem = {
  productId: string;
  productKey: string;
  name: string;
  brand: string;
  watch: ItemWatchMode;
  baselinePrice: number;
  baselineStore: string;
  targetPrice?: number;
};

export type PriceWatchDoc = {
  deviceId: string;
  listId: string;
  listName: string;
  zip: string;
  enabled: boolean;
  items: PriceWatchItem[];
};

export type PriceAlertDoc = {
  _id: mongoose.Types.ObjectId;
  deviceId: string;
  listId: string;
  listName: string;
  productId: string;
  productKey: string;
  itemName: string;
  storeName: string;
  oldPrice: number;
  newPrice: number;
  savings: number;
  baselinePrice: number;
  targetPrice?: number;
  hitTarget: boolean;
  reason: "saved" | "target" | "both";
  dropKey: string;
  seenAt: Date | null;
  pushState: "pending" | "sent" | "skipped" | "failed";
  pushAttempts: number;
  createdAt?: Date;
};

export type PushSubscriptionDoc = {
  _id: mongoose.Types.ObjectId;
  deviceId: string;
  channel: "web" | "native";
  endpoint?: string;
  p256dh?: string;
  auth?: string;
  nativeToken?: string;
  platform?: "web" | "ios" | "android";
};

export const PriceWatch = mongoose.model("PriceWatch", priceWatchSchema);
export const PriceAlert = mongoose.model("PriceAlert", priceAlertSchema);
export const PushSubscription = mongoose.model("PushSubscription", pushSubscriptionSchema);
