import { fetchMatchingProductsForQuery } from "./fetchMatchingProducts";
import { KrogerPricingError, krogerService } from "./krogerService";
import { Product } from "./models/Product";
import type { CatalogProduct } from "./optimizeGroceryList";
import { parseGroceryList } from "./parseGroceryLine";
import { productSearchAttempts } from "./productSearchQuery";

export const PRICE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ResolvedCatalog = {
  products: CatalogProduct[];
  pricingError?: string;
};

function catalogKey(product: CatalogProduct): string {
  return `${product.storeName}|${product.locationId ?? ""}|${product.brand}|${product.name}|${product.price}`;
}

function toCatalogProduct(doc: {
  name: string;
  brand: string;
  storeName: string;
  locationId?: string | null;
  price: number;
  unit: string;
  normalizedUnit: string;
  lastUpdated?: Date;
  updatedAt?: Date;
}): CatalogProduct {
  return {
    name: doc.name,
    brand: doc.brand,
    storeName: doc.storeName,
    locationId: doc.locationId ?? undefined,
    price: doc.price,
    unit: doc.unit,
    normalizedUnit: doc.normalizedUnit,
    lastUpdated: doc.lastUpdated,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Writes live shelf prices into MongoDB, refreshing `updatedAt` so the next
 * request within 24 hours is a cache hit.
 */
export async function upsertLiveProducts(
  products: CatalogProduct[]
): Promise<CatalogProduct[]> {
  const now = new Date();
  const saved: CatalogProduct[] = [];

  for (const product of products) {
    const filter: Record<string, unknown> = {
      name: product.name,
      brand: product.brand,
      storeName: product.storeName,
    };
    if (product.locationId) {
      filter.locationId = product.locationId;
    }

    const doc = await Product.findOneAndUpdate(
      filter,
      {
        $set: {
          name: product.name,
          brand: product.brand,
          storeName: product.storeName,
          locationId: product.locationId,
          price: product.price,
          unit: product.unit,
          normalizedUnit: product.normalizedUnit,
          lastUpdated: now,
          updatedAt: now,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        timestamps: true,
      }
    ).lean();

    if (doc) {
      saved.push(toCatalogProduct(doc));
    }
  }

  return saved;
}

/**
 * Per grocery item: use Mongo rows newer than 24 hours; on a cache miss,
 * pull live Kroger prices and upsert them before returning.
 */
export async function resolveCatalogProducts(
  groceryList: string[],
  stores: string[] = [],
  locationId?: string
): Promise<ResolvedCatalog> {
  const lines = parseGroceryList(groceryList);
  const minUpdatedAt = new Date(Date.now() - PRICE_CACHE_MAX_AGE_MS);
  const products: CatalogProduct[] = [];
  const seen = new Set<string>();
  let pricingError: string | undefined;

  const add = (batch: CatalogProduct[], sourceQuery?: string): void => {
    for (const product of batch) {
      const tagged = sourceQuery
        ? { ...product, sourceQuery }
        : product;
      const key = catalogKey(tagged);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      products.push(tagged);
    }
  };

  for (const line of lines) {
    const cached = await fetchMatchingProductsForQuery(
      line.name,
      stores,
      locationId,
      { minUpdatedAt }
    );
    if (cached.length > 0) {
      add(cached, line.name);
      continue;
    }

    let live: CatalogProduct[] = [];
    try {
      for (const term of productSearchAttempts(line.name)) {
        live = await krogerService.searchProducts(term, locationId);
        if (live.length > 0) {
          break;
        }
      }
    } catch (error) {
      const message =
        error instanceof KrogerPricingError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      pricingError = pricingError ?? message;
      console.warn(`Live Kroger pricing failed for "${line.name}": ${message}`);
      live = [];
    }
    if (live.length > 0) {
      add(await upsertLiveProducts(live), line.name);
      continue;
    }

    // Live API empty/unavailable: still optimize from stale local rows.
    add(await fetchMatchingProductsForQuery(line.name, stores, locationId), line.name);
  }

  products.sort((a, b) => a.price - b.price);
  return { products, pricingError };
}
