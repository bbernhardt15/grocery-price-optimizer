import mongoose, { Schema } from "mongoose";

const catalogCacheSchema = new Schema(
  {
    cacheKey: { type: String, required: true, unique: true },
    products: { type: Schema.Types.Mixed, required: true },
    warnings: { type: [String], default: [] },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false }
);

catalogCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type CatalogCacheDocument = {
  cacheKey: string;
  products: unknown;
  warnings?: string[];
  expiresAt: Date;
};

export const CatalogCache = mongoose.model("CatalogCache", catalogCacheSchema);
