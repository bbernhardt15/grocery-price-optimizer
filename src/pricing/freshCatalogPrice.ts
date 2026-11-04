import { upcKey } from "../catalog/normalize";
import type { CatalogProduct, PriceSource } from "../optimizeGroceryList";
import { Product } from "../models/Product";
import { catalogPriceIsFresh, FRESH_CATALOG_MS } from "./freshPriceKey";

export { catalogPriceIsFresh, FRESH_CATALOG_MS, priceCacheKey } from "./freshPriceKey";

type FreshDoc = {
  name?: string;
  brand?: string;
  storeName?: string;
  locationId?: string | null;
  productId?: string | null;
  upc?: string | null;
  price?: number;
  size?: string | null;
  unit?: string;
  normalizedUnit?: string;
  updatedAt?: Date;
  priceSource?: string | null;
};

function toProduct(doc: FreshDoc): CatalogProduct | null {
  const price = Number(doc.price);
  if (!doc.name || !doc.storeName || !Number.isFinite(price) || price < 0) return null;
  const source: PriceSource = doc.priceSource === "weekly_ad" ? "weekly_ad" : doc.priceSource === "live" ? "cached_live" : "seed";
  return {
    name: doc.name,
    brand: doc.brand || "",
    storeName: doc.storeName,
    price,
    unit: doc.unit || "count",
    normalizedUnit: doc.normalizedUnit || doc.unit || "count",
    ...(doc.locationId ? { locationId: doc.locationId } : {}),
    ...(doc.productId ? { productId: doc.productId } : {}),
    ...(doc.upc ? { upc: doc.upc } : {}),
    ...(doc.size ? { size: doc.size } : {}),
    updatedAt: doc.updatedAt,
    priceSource: source,
  };
}

/**
 * Live rows for this store and UPC that were priced within 24 hours.
 * A miss returns nothing so the caller can still hit the retailer.
 */
export async function findFreshUpcPrices(input: {
  storeName: string;
  upc: string;
  locationId?: string;
  zip?: string;
  now?: number;
}): Promise<CatalogProduct[]> {
  const key = upcKey(input.upc);
  if (!key || !input.storeName?.trim()) return [];
  const since = new Date((input.now || Date.now()) - FRESH_CATALOG_MS);
  const codes = [...new Set([input.upc, key, input.upc.replace(/\D/g, "")].map((code) => String(code || "").trim()).filter(Boolean))];
  try {
    const docs = await Product.find({
      storeName: input.storeName.trim(),
      updatedAt: { $gte: since },
      priceSource: { $in: ["live", "weekly_ad"] },
      $or: [{ upc: { $in: codes } }, { productId: { $in: codes } }],
    })
      .sort({ updatedAt: -1 })
      .limit(6)
      .lean<FreshDoc[]>();
    const location = String(input.locationId || "").trim();
    const rows = (docs || []).filter((doc) => catalogPriceIsFresh(doc.updatedAt, input.now));
    const matched = location
      ? rows.filter((doc) => !doc.locationId || doc.locationId === location)
      : rows;
    return matched.map(toProduct).filter((row): row is CatalogProduct => row !== null);
  } catch {
    return [];
  }
}
