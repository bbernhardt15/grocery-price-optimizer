import { fetchMatchingProductsForQuery } from "./fetchMatchingProducts";
import { Product } from "./models/Product";
import type { CatalogProduct, PriceSource } from "./optimizeGroceryList";
import { parseGroceryList } from "./parseGroceryLine";
import {
  competingStoreNames,
  dedicatedProviderForStore,
  providerForStore,
} from "./pricing/providers";
import { flippProviderForStore } from "./pricing/flipp/flippProvider";
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

type StoredPriceSource = "live" | "weekly_ad" | "seed";

function catalogKey(product: CatalogProduct): string {
  return `${product.storeName}|${product.locationId ?? ""}|${product.brand}|${product.name}|${product.price}|${product.priceSource ?? ""}`;
}

function storedPriceSource(value: string | null | undefined): StoredPriceSource {
  if (value === "live") {
    return "live";
  }
  if (value === "weekly_ad") {
    return "weekly_ad";
  }
  return "seed";
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
  priceSource?: "live" | "weekly_ad" | "seed" | null;
}): CatalogProduct {
  const stored = storedPriceSource(doc.priceSource);
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

function krogerLocationId(
  storeName: string,
  locationId?: string
): string | undefined {
  return storeName.trim().toLowerCase() === "kroger" ? locationId : undefined;
}

function zipLocationId(zipCode?: string): string | undefined {
  const zip = zipCode?.trim().replace(/\D/g, "").slice(0, 5);
  return zip && /^\d{5}$/.test(zip) ? zip : undefined;
}

function persistableSource(product: CatalogProduct): StoredPriceSource {
  return product.priceSource === "weekly_ad" ? "weekly_ad" : "live";
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
 * Writes retailer or weekly-ad prices into MongoDB, refreshing `updatedAt`
 * so the next request within 24 hours is a cache hit. Seed rows are never
 * written here.
 */
export async function upsertLiveProducts(
  products: CatalogProduct[]
): Promise<CatalogProduct[]> {
  const now = new Date();
  const saved: CatalogProduct[] = [];

  for (const product of products) {
    const priceSource = persistableSource(product);
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
          priceSource,
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
      saved.push({ ...toCatalogProduct(doc), priceSource });
    }
  }

  return saved;
}

async function searchWithProvider(
  provider: { searchProducts: (term: string, context?: { zipCode?: string; locationId?: string }) => Promise<CatalogProduct[]> },
  storeName: string,
  itemName: string,
  zipCode: string | undefined,
  krogerStoreId: string | undefined
): Promise<CatalogProduct[]> {
  const locationId = krogerLocationId(storeName, krogerStoreId);
  for (const term of productSearchAttempts(itemName)) {
    const rows = await provider.searchProducts(term, {
      zipCode,
      locationId,
    });
    if (rows.length > 0) {
      return rows.map((product) => ({
        ...product,
        storeName,
        priceSource:
          product.priceSource === "weekly_ad" ? "weekly_ad" : ("live" as const),
      }));
    }
  }
  return [];
}

/**
 * Per grocery item, per competing store: use Mongo live rows newer than 24
 * hours; on a miss, call that store's dedicated retailer API (Kroger
 * Products, Walmart Affiliate, Target partner feed) when configured; then
 * Flipp weekly-ad deals when enabled and a ZIP is set; otherwise fall back
 * to seed/stale rows labeled as demo.
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
  const zip = zipLocationId(zipCode);

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
      const krogerId = krogerLocationId(storeName, locationId);
      const dedicated = dedicatedProviderForStore(storeName);
      const flipp = flippProviderForStore(storeName);

      const liveCached = await fetchMatchingProductsForQuery(
        line.name,
        [storeName],
        krogerId,
        { minUpdatedAt, priceSource: "live" }
      );
      if (liveCached.length > 0) {
        add(liveCached, line.name, "cached_live");
        acc.cachedHits += 1;
        continue;
      }

      let dedicatedError: string | undefined;
      if (dedicated?.isConfigured()) {
        acc.configured = true;
        acc.attempted = true;
        try {
          const live = await searchWithProvider(
            dedicated,
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
          dedicatedError = errorMessage(error);
          console.warn(
            `Live ${storeName} pricing failed for "${line.name}": ${dedicatedError}`
          );
        }
      } else if (dedicated) {
        const isKroger = storeName.trim().toLowerCase() === "kroger";
        if (isKroger) {
          dedicatedError = dedicated.setupHint();
        }
      }

      if (flipp?.isConfigured() && zip) {
        const weeklyCached = await fetchMatchingProductsForQuery(
          line.name,
          [storeName],
          zip,
          { minUpdatedAt, priceSource: "weekly_ad" }
        );
        if (weeklyCached.length > 0) {
          add(weeklyCached, line.name, "weekly_ad");
          acc.cachedWeeklyAdHits += 1;
          acc.configured = true;
          continue;
        }

        acc.configured = true;
        acc.attempted = true;
        try {
          const deals = await searchWithProvider(
            flipp,
            storeName,
            line.name,
            zipCode,
            locationId
          );
          if (deals.length > 0) {
            const saved = await upsertLiveProducts(deals);
            add(saved, line.name, "weekly_ad");
            acc.weeklyAdHits += 1;
            acc.fetchedAt = new Date();
            continue;
          }
        } catch (error) {
          const message = errorMessage(error);
          acc.errors.push(message);
          console.warn(
            `Weekly-ad ${storeName} pricing failed for "${line.name}": ${message}`
          );
        }
      } else if (!dedicated && flipp && !flipp.isConfigured()) {
        acc.errors.push(flipp.setupHint());
      } else if (!dedicated && !flipp) {
        acc.errors.push(
          `${storeName} has no live or weekly-ad pricing provider. Demo catalog only.`
        );
      }

      if (dedicatedError) {
        acc.errors.push(dedicatedError);
      }

      const fallback = await fetchMatchingProductsForQuery(
        line.name,
        [storeName],
        krogerId
      );
      if (fallback.length === 0) {
        continue;
      }

      const liveFallback = fallback.filter(
        (product) => product.priceSource === "live"
      );
      const weeklyFallback = fallback.filter(
        (product) => product.priceSource === "weekly_ad"
      );
      const seedFallback = fallback.filter(
        (product) =>
          product.priceSource !== "live" && product.priceSource !== "weekly_ad"
      );

      if (liveFallback.length > 0) {
        add(liveFallback, line.name, "cached_live");
        acc.cachedHits += 1;
      } else if (weeklyFallback.length > 0) {
        add(weeklyFallback, line.name, "weekly_ad");
        acc.cachedWeeklyAdHits += 1;
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
