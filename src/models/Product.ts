import mongoose, { Schema, InferSchemaType } from "mongoose";

const groceryUnits = ["oz", "lbs", "count", "g", "kg", "ml", "l", "gal"] as const;

const productSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    brand: { type: String, required: true, trim: true },
    storeName: { type: String, required: true, trim: true },
    locationId: { type: String, trim: true, index: true },
    productId: { type: String, trim: true },
    upc: { type: String, trim: true },
    price: { type: Number, required: true, min: 0 },
    unit: {
      type: String,
      required: true,
      trim: true,
      enum: groceryUnits,
    },
    // Canonical unit used for price-per-unit comparison (e.g. "oz" when the package is sold in lbs).
    normalizedUnit: {
      type: String,
      required: true,
      trim: true,
      enum: groceryUnits,
    },
    lastUpdated: { type: Date, required: true, default: Date.now },
    /** live = upserted from a retailer API; seed = demo catalog / unknown. */
    priceSource: {
      type: String,
      enum: ["live", "seed"],
      default: "seed",
      index: true,
    },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
  }
);

productSchema.index({ name: 1, brand: 1, storeName: 1, locationId: 1 });
productSchema.index({ name: 1, updatedAt: -1 });
productSchema.index({ name: "text" });

export type ProductDocument = InferSchemaType<typeof productSchema> & {
  _id: mongoose.Types.ObjectId;
  updatedAt: Date;
};

export const Product = mongoose.model("Product", productSchema);
