import { fetchMatchingProductsForQuery } from "./fetchMatchingProducts";
import { Product } from "./models/Product";
import type { CatalogProduct, PriceSource } from "./optimizeGroceryList";
import { parseGroceryList } from "./parseGroceryLine";
import { competingStoreNames, providerForStore } from "./pricing/providers";
import {
  emptyAccumulator,
  finalizeStoreReport,
  pricingWarningFromReports,
} from "./pricing/reports";
import type {
  StorePricingAccumulator,
  StorePricingReport,
} from "./pricing/types";
import { StorePricingError } from "./pricing/types";
import { productSearchAttempts } from "./productSearchQuery";

export const PRICE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ResolvedCatalog = {
  products: CatalogProduct[];
  pricingError?: string;
  pricingByStore: StorePricingReport[];
};

function catalogKey(product: CatalogProduct): string {
  return `${product.storeName}|${product.locationId ?? ""}|${product.brand}|${product.name}|${product.price}|${product.priceSource ?? ""}`;
}

function toCatalogProduct(doc: {
  name: string;
  brand: string;
  storeName: string;
  locationId?: string | null;
  productId?: string | null;
  upc?: string | null;
  price: number;
  unit: string;
  normalizedUnit: string;
  lastUpdated?: Date;
  updatedAt?: Date;
  priceSource?: "live" | "seed" | null;
}): CatalogProduct {
  const stored: PriceSource = doc.priceSource === "live" ? "live" : "seed";
  return {
    name: doc.name,
    brand: doc.brand,
    storeName: doc.storeName,
    locationId: doc.locationId ?? undefined,
    productId: doc.productId ?? undefined,
    upc: doc.upc ?? undefined,
    price: doc.price,
    unit: doc.unit,
    normalizedUnit: doc.normalizedUnit,
    lastUpdated: doc.lastUpdated,
    updatedAt: doc.updatedAt,
    priceSource: stored,
  };
}

function locationForStore(
  storeName: string,
  krogerLocationId?: string
): string | undefined {
  return storeName.trim().toLowerCase() === "kroger"
    ? krogerLocationId
    : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof StorePricingError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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
          productId: product.productId,
          upc: product.upc,
          price: product.price,
          unit: product.unit,
          normalizedUnit: product.normalizedUnit,
          lastUpdated: now,
          updatedAt: now,
          priceSource: "live",
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
      saved.push({ ...toCatalogProduct(doc), priceSource: "live" });
    }
  }

  return saved;
}

async function liveSearch(
  storeName: string,
  itemName: string,
  zipCode: string | undefined,
  krogerLocationId: string | undefined
): Promise<CatalogProduct[]> {
  const provider = providerForStore(storeName);
  if (!provider) {
    return [];
  }

  const locationId = locationForStore(storeName, krogerLocationId);
  for (const term of productSearchAttempts(itemName)) {
    const live = await provider.searchProducts(term, {
      zipCode,
      locationId,
    });
    if (live.length > 0) {
      return live.map((product) => ({
        ...product,
        storeName: provider.storeName,
        priceSource: "live" as const,
      }));
    }
  }
  return [];
}

/**
 * Per grocery item, per competing store: use Mongo live rows newer than 24
 * hours; on a miss, call that store's pricing provider (Kroger Products,
 * Walmart Affiliate, Target partner feed) and upsert; otherwise fall back to
 * seed/stale rows labeled as demo.
 */
export async function resolveCatalogProducts(
  groceryList: string[],
  stores: string[] = [],
  locationId?: string,
  zipCode?: string
): Promise<ResolvedCatalog> {
  const lines = parseGroceryList(groceryList);
  const minUpdatedAt = new Date(Date.now() - PRICE_CACHE_MAX_AGE_MS);
  const competing = competingStoreNames(stores);
  const products: CatalogProduct[] = [];
  const seen = new Set<string>();
  const accumulators = new Map<string, StorePricingAccumulator>();

  for (const storeName of competing) {
    const acc = emptyAccumulator(storeName);
    const provider = providerForStore(storeName);
    acc.configured = provider?.isConfigured() ?? false;
    if (storeName.trim().toLowerCase() === "kroger" && locationId) {
      acc.locationId = locationId;
    }
    accumulators.set(storeName.toLowerCase(), acc);
  }

  const accFor = (storeName: string): StorePricingAccumulator => {
    const key = storeName.trim().toLowerCase();
    const existing = accumulators.get(key);
    if (existing) {
      return existing;
    }
    const created = emptyAccumulator(storeName);
    accumulators.set(key, created);
    return created;
  };

  const add = (
    batch: CatalogProduct[],
    sourceQuery: string,
    priceSource: PriceSource
  ): void => {
    for (const product of batch) {
      const tagged: CatalogProduct = {
        ...product,
        sourceQuery,
        priceSource,
      };
      const key = catalogKey(tagged);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      products.push(tagged);
    }
  };

  for (const line of lines) {
    for (const storeName of competing) {
      const acc = accFor(storeName);
      const storeLocationId = locationForStore(storeName, locationId);
      const provider = providerForStore(storeName);

      const liveCached = await fetchMatchingProductsForQuery(
        line.name,
        [storeName],
        storeLocationId,
        { minUpdatedAt, priceSource: "live" }
      );
      if (liveCached.length > 0) {
        add(liveCached, line.name, "cached_live");
        acc.cachedHits += 1;
        continue;
      }

      if (provider) {
        if (!provider.isConfigured()) {
          acc.configured = false;
          acc.errors.push(provider.setupHint());
        } else {
          acc.configured = true;
          acc.attempted = true;
          try {
            const live = await liveSearch(
              storeName,
              line.name,
              zipCode,
              locationId
            );
            if (live.length > 0) {
              const saved = await upsertLiveProducts(live);
              add(saved, line.name, "live");
              acc.liveHits += 1;
              acc.fetchedAt = new Date();
              continue;
            }
          } catch (error) {
            const message = errorMessage(error);
            acc.errors.push(message);
            console.warn(
              `Live ${storeName} pricing failed for "${line.name}": ${message}`
            );
          }
        }
      }

      const fallback = await fetchMatchingProductsForQuery(
        line.name,
        [storeName],
        storeLocationId
      );
      if (fallback.length === 0) {
        continue;
      }

      const liveFallback = fallback.filter(
        (product) => product.priceSource === "live"
      );
      const seedFallback = fallback.filter(
        (product) => product.priceSource !== "live"
      );

      if (liveFallback.length > 0) {
        add(liveFallback, line.name, "cached_live");
        acc.cachedHits += 1;
      } else if (seedFallback.length > 0) {
        add(seedFallback, line.name, "seed");
        acc.seedHits += 1;
      }
    }
  }

  const pricingByStore: StorePricingReport[] = competing.map((storeName) => {
    const acc = accFor(storeName);
    const provider = providerForStore(storeName);
    const setupHint = provider
      ? provider.setupHint()
      : `${storeName} has no live pricing provider. Demo catalog only.`;
    return finalizeStoreReport(acc, setupHint);
  });

  products.sort((a, b) => a.price - b.price);
  return {
    products,
    pricingError: pricingWarningFromReports(pricingByStore),
    pricingByStore,
  };
}
