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
    walmartItemId: { type: String },
    krogerProductId: { type: String },
    lastSeenAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "stale", "discontinued"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true }
);

masterSchema.index({ name: "text", brand: "text" });
masterSchema.index({ departmentId: 1, status: 1, name: 1 });

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
    recentErrors: { type: [String], default: [] },
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
  walmartItemId?: string;
  krogerProductId?: string;
  lastSeenAt: Date;
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
  status: CatalogStatus;
};

export const CatalogMaster = mongoose.model("CatalogMaster", masterSchema);
export const CatalogOffer = mongoose.model("CatalogOffer", offerSchema);
export const IngestCheckpoint = mongoose.model("IngestCheckpoint", checkpointSchema);
export const IngestLock = mongoose.model("IngestLock", lockSchema);
export const IngestBudget = mongoose.model("IngestBudget", budgetSchema);
export const ShopperZip = mongoose.model("ShopperZip", shopperZipSchema);
