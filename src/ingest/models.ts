import mongoose, { Schema } from "mongoose";

const masterSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    upc: { type: String, index: true },
    name: { type: String, required: true },
    brand: { type: String, required: true },
    imageUrls: { type: [String], default: [] },
    departmentId: { type: String, required: true },
    subcategory: { type: String },
    categoryPaths: { type: [String], default: [] },
    size: { type: String },
    /** Brand + flavor. Pack, unit size, and container stay off this key. */
    familyKey: { type: String },
    familyName: { type: String },
    variantLabel: { type: String },
    walmartItemId: { type: String },
    krogerProductId: { type: String },
    lastSeenAt: { type: Date, required: true },
    /** Last finished cross-store lookup. A miss is tried again after the cooldown. Not a delete. */
    matchWalmartAt: { type: Date },
    matchKrogerAt: { type: Date },
    /** Server error hold. The row is not a miss and is not counted in the hit rate. */
    matchWalmartHoldUntil: { type: Date },
    matchKrogerHoldUntil: { type: Date },
    /** Next GTIN variant to send. Zero means the primary code. */
    matchWalmartVariant: { type: Number },
    matchKrogerVariant: { type: Number },
    /** When this master first carried both a Walmart id and a Kroger id. */
    mergedAt: { type: Date },
    status: {
      type: String,
      enum: ["active", "stale", "discontinued"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

masterSchema.index({ familyKey: 1, status: 1 });
masterSchema.index({ name: "text", brand: "text" });
masterSchema.index({ departmentId: 1, status: 1, name: 1 });
masterSchema.index({ matchWalmartAt: 1, departmentId: 1 });
masterSchema.index({ matchKrogerAt: 1, departmentId: 1 });
masterSchema.index({ mergedAt: 1 });

const offerSchema = new Schema(
  {
    productKey: { type: String, required: true },
    storeName: { type: String, required: true },
    locationId: { type: String, default: "" },
    zip: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number },
    unitPriceText: { type: String },
    size: { type: String },
    onSale: { type: Boolean, default: false },
    availability: {
      type: String,
      enum: ["in_stock", "out_of_stock", "unknown"],
      default: "unknown",
    },
    retailerItemId: { type: String },
    productUrl: { type: String },
    priceSource: { type: String, enum: ["live", "seed"], default: "live" },
    lastSeenAt: { type: Date, required: true },
    /** Set by the admin exclude action. Refresh will not spend a call on this offer. */
    refreshExcluded: { type: Boolean, default: false },
    /** Last refresh attempt, including a miss. Tried again after a day. */
    refreshAttemptAt: { type: Date },
    /** Confirmed misses. Three in a row leaves the offer out of the queue. */
    refreshMisses: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "stale", "discontinued"],
      default: "active",
    },
  },
  { timestamps: true }
);

offerSchema.index({ productKey: 1, storeName: 1, locationId: 1 }, { unique: true });
offerSchema.index({ storeName: 1, locationId: 1, status: 1 });
offerSchema.index({ storeName: 1, zip: 1, status: 1 });
offerSchema.index({ status: 1, lastSeenAt: 1 });
offerSchema.index({ storeName: 1, status: 1, lastSeenAt: 1 });

const checkpointSchema = new Schema(
  {
    provider: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["idle", "running", "paused", "completed", "error"],
      default: "idle",
    },
    checkpoint: { type: Schema.Types.Mixed, default: {} },
    lastStartedAt: { type: Date },
    lastFinishedAt: { type: Date },
    lastError: { type: String },
    recentErrors: { type: [Schema.Types.Mixed], default: [] },
    calls: { type: Number, default: 0 },
    upserted: { type: Number, default: 0 },
    cycles: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const lockSchema = new Schema({
  _id: { type: String },
  owner: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

const budgetSchema = new Schema({
  provider: { type: String, required: true },
  day: { type: String, required: true },
  calls: { type: Number, required: true, default: 0 },
});
budgetSchema.index({ provider: 1, day: 1 }, { unique: true });

const shopperZipSchema = new Schema({
  zip: { type: String, required: true, unique: true },
  hits: { type: Number, default: 0 },
  lastSeenAt: { type: Date, required: true },
  locationId: { type: String },
});

const catalogDemandSchema = new Schema({
  kind: { type: String, enum: ["list", "search"], required: true },
  text: { type: String, required: true },
  upcKey: { type: String },
  hits: { type: Number, default: 0 },
  lastSeenAt: { type: Date, required: true },
});
catalogDemandSchema.index({ kind: 1, text: 1 }, { unique: true });
catalogDemandSchema.index({ lastSeenAt: -1 });
catalogDemandSchema.index({ upcKey: 1, lastSeenAt: -1 });

const matchDaySchema = new Schema({
  day: { type: String, required: true, unique: true },
  walmartAttempts: { type: Number, default: 0 },
  walmartHits: { type: Number, default: 0 },
  krogerAttempts: { type: Number, default: 0 },
  krogerHits: { type: Number, default: 0 },
});

const refreshDaySchema = new Schema({
  day: { type: String, required: true, unique: true },
  walmart: { type: Number, default: 0 },
  kroger: { type: Number, default: 0 },
  /** Affiliate or Kroger HTTP calls spent on refresh today. A batch is one call. */
  walmartCalls: { type: Number, default: 0 },
  krogerCalls: { type: Number, default: 0 },
  /** Offers those calls asked about, including misses. */
  walmartAttempted: { type: Number, default: 0 },
  krogerAttempted: { type: Number, default: 0 },
});

const maintenanceJobSchema = new Schema(
  {
    kind: { type: String, required: true, unique: true },
    jobId: { type: String, default: "" },
    status: { type: String, enum: ["idle", "running", "completed", "error"], default: "idle" },
    examined: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    clearedExclusions: { type: Number, default: 0 },
    setExclusions: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    cursor: { type: String, default: "" },
    error: { type: String, default: "" },
    startedAt: { type: Date },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

export type CatalogStatus = "active" | "stale" | "discontinued";

export type CatalogMasterDoc = {
  key: string;
  upc?: string;
  name: string;
  brand: string;
  imageUrls: string[];
  departmentId: string;
  subcategory?: string;
  categoryPaths: string[];
  size?: string;
  familyKey?: string;
  familyName?: string;
  variantLabel?: string;
  walmartItemId?: string;
  krogerProductId?: string;
  lastSeenAt: Date;
  matchWalmartAt?: Date;
  matchKrogerAt?: Date;
  matchWalmartHoldUntil?: Date;
  matchKrogerHoldUntil?: Date;
  matchWalmartVariant?: number;
  matchKrogerVariant?: number;
  mergedAt?: Date;
  status: CatalogStatus;
};

export type CatalogOfferDoc = {
  productKey: string;
  storeName: string;
  locationId: string;
  zip: string;
  price: number;
  unitPrice?: number;
  unitPriceText?: string;
  size?: string;
  onSale: boolean;
  availability: "in_stock" | "out_of_stock" | "unknown";
  retailerItemId?: string;
  productUrl?: string;
  priceSource: "live" | "seed";
  lastSeenAt: Date;
  refreshExcluded?: boolean;
  refreshAttemptAt?: Date;
  refreshMisses?: number;
  status: CatalogStatus;
};

export const CatalogMaster = mongoose.model("CatalogMaster", masterSchema);
export const CatalogOffer = mongoose.model("CatalogOffer", offerSchema);
export const IngestCheckpoint = mongoose.model("IngestCheckpoint", checkpointSchema);
export const IngestLock = mongoose.model("IngestLock", lockSchema);
export const IngestBudget = mongoose.model("IngestBudget", budgetSchema);
export const ShopperZip = mongoose.model("ShopperZip", shopperZipSchema);
export const CatalogDemand = mongoose.model("CatalogDemand", catalogDemandSchema);
export const CatalogMatchDay = mongoose.model("CatalogMatchDay", matchDaySchema);
export const CatalogRefreshDay = mongoose.model("CatalogRefreshDay", refreshDaySchema);
export const CatalogMaintenanceJob = mongoose.model("CatalogMaintenanceJob", maintenanceJobSchema);
