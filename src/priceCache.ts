import { fetchMatchingProductsForQuery } from "./fetchMatchingProducts";
import { Product } from "./models/Product";
import type { CatalogProduct, PriceSource } from "./optimizeGroceryList";
import { publishSale } from "./pricing/saleFacts";
import { parseGroceryList } from "./parseGroceryLine";
import {
  competingStoreNames,
  dedicatedProviderForStore,
  providerForStore,
} from "./pricing/providers";
import { flippProviderForStore } from "./pricing/flipp/flippProvider";
import { allowsDemoFallback } from "./pricing/flipp/merchants";
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
import { ingestConfig } from "./ingest/config";
import { storedLineProducts } from "./ingest/readStore";
import { upsertCatalogRecords } from "./ingest/upsert";
import { rawFromCatalogProduct } from "./catalog/providers/fromCatalogProduct";

export const PRICE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ResolvedCatalog = {
  products: CatalogProduct[];
  pricingError?: string;
  pricingByStore: StorePricingReport[];
  /** True when the budget ran out and some store lookups were not started. */
  partial?: boolean;
  pendingStores?: string[];
};

/** A small list should finish. A slow store must not hold the rest forever. */
const PRICE_BUDGET_MS = 18_000;
const PRICE_POOL = 6;

type StoredPriceSource = "live" | "weekly_ad" | "seed";

function catalogKey(product: CatalogProduct): string {
  return `${product.storeName}|${product.locationId ?? ""}|${product.brand}|${product.name}|${product.size ?? ""}|${product.price}|${product.priceSource ?? ""}`;
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
  size?: string | null;
  unit: string;
  normalizedUnit: string;
  lastUpdated?: Date;
  updatedAt?: Date;
  priceSource?: "live" | "weekly_ad" | "seed" | null;
  onSale?: boolean | null;
  regularPrice?: number | null;
  saleEndsOn?: string | null;
}): CatalogProduct {
  const stored = storedPriceSource(doc.priceSource);
  const sale = publishSale({
    price: doc.price,
    onSale: doc.onSale === true,
    regularPrice: doc.regularPrice ?? undefined,
    saleEndsOn: doc.saleEndsOn ?? undefined,
  });
  return {
    name: doc.name,
    brand: doc.brand,
    storeName: doc.storeName,
    locationId: doc.locationId ?? undefined,
    productId: doc.productId ?? undefined,
    upc: doc.upc ?? undefined,
    price: doc.price,
    ...(doc.size ? { size: doc.size } : {}),
    unit: doc.unit,
    normalizedUnit: doc.normalizedUnit,
    lastUpdated: doc.lastUpdated,
    updatedAt: doc.updatedAt,
    priceSource: stored,
    ...(sale ?? {}),
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
          ...(product.size ? { size: product.size } : {}),
          unit: product.unit,
          normalizedUnit: product.normalizedUnit,
          lastUpdated: now,
          updatedAt: now,
          priceSource,
          onSale: Boolean(product.onSale),
          ...(product.onSale && product.regularPrice != null ? { regularPrice: product.regularPrice } : {}),
          ...(product.onSale && product.saleEndsOn ? { saleEndsOn: product.saleEndsOn } : {}),
        },
        ...(product.onSale && product.regularPrice != null && product.saleEndsOn
          ? {}
          : {
              $unset: {
                ...(product.onSale && product.regularPrice != null ? {} : { regularPrice: "" }),
                ...(product.onSale && product.saleEndsOn ? {} : { saleEndsOn: "" }),
              },
            }),
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

function perItemProviderFailure(error: unknown): boolean {
  if (error instanceof StorePricingError && error.status === 400 && /products request failed/i.test(error.message)) {
    return true;
  }
  return error instanceof Error && /products request failed \(400\)/i.test(error.message);
}

async function searchWithProvider(
  provider: { searchProducts: (term: string, context?: { zipCode?: string; locationId?: string; upc?: string }) => Promise<CatalogProduct[]> },
  storeName: string,
  itemName: string,
  zipCode: string | undefined,
  krogerStoreId: string | undefined,
  upc?: string
): Promise<CatalogProduct[]> {
  const locationId = krogerLocationId(storeName, krogerStoreId);
  for (const term of productSearchAttempts(itemName)) {
    const rows = await provider.searchProducts(term, {
      zipCode,
      locationId,
      ...(upc ? { upc } : {}),
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
 * Products, Walmart Affiliate, Target partner feed, licensed partner stubs)
 * when configured; then Flipp weekly-ad deals when enabled and a ZIP is set;
 * otherwise fall back to seed/stale rows labeled as demo.
 */
export async function resolveCatalogProducts(
  groceryList: string[],
  stores: string[] = [],
  locationId?: string,
  zipCode?: string,
  hooks?: {
    onStore?: (info: { storeName: string; ms: number; pendingStores: string[]; products: CatalogProduct[] }) => void;
    upcByName?: Map<string, string>;
  }
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
    acc.feedKind = provider?.feedKind;
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
    const provider = providerForStore(storeName);
    created.configured = provider?.isConfigured() ?? false;
    created.feedKind = provider?.feedKind;
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

  const storeMs = new Map<string, number>();
  const storeLeft = new Map<string, number>();
  for (const storeName of competing) storeLeft.set(storeName, lines.length);
  const jobs: Array<() => Promise<void>> = [];
  for (const line of lines) {
    for (const storeName of competing) {
      jobs.push(async () => {
      const started = Date.now();
      let source = "miss";
      try {
      const acc = accFor(storeName);
      const krogerId = krogerLocationId(storeName, locationId);
      const dedicated = dedicatedProviderForStore(storeName);
      const flipp = flippProviderForStore(storeName);

      if (ingestConfig().dbFirst) {
        const storedKey = storeName.trim().toLowerCase();
        if (storedKey === "walmart" || storedKey === "kroger") {
          const stored = await storedLineProducts(line.name, storeName, krogerId);
          if (stored.length > 0) {
            const seeded = stored.every((product) => product.priceSource === "seed");
            add(stored, line.name, seeded ? "seed" : "cached_live");
            if (seeded) {
              acc.seedHits += 1;
            } else {
              acc.cachedHits += 1;
            }
            source = seeded ? "seed" : "cached_live";
            return;
          }
        }
      }

      const liveCached = await fetchMatchingProductsForQuery(
        line.name,
        [storeName],
        krogerId,
        { minUpdatedAt, priceSource: "live" }
      );
      if (liveCached.length > 0) {
        add(liveCached, line.name, "cached_live");
        acc.cachedHits += 1;
        source = "cached_live";
        return;
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
            locationId,
            hooks?.upcByName?.get(line.name.toLowerCase())
          );
          if (live.length > 0) {
            const saved = await upsertLiveProducts(live);
            add(saved, line.name, "live");
            acc.liveHits += 1;
            acc.fetchedAt = new Date();
            source = "live";
            if (ingestConfig().dbFirst && (storeName.trim().toLowerCase() === "walmart" || storeName.trim().toLowerCase() === "kroger")) {
              const records = live
                .map((product) => rawFromCatalogProduct(product, "live"))
                .filter((record): record is NonNullable<typeof record> => record !== null);
              await upsertCatalogRecords(records).catch((error: unknown) => {
                console.warn(`Catalog write-back failed: ${error instanceof Error ? error.message : String(error)}`);
              });
            }
            return;
          }
        } catch (error) {
          dedicatedError = errorMessage(error);
          if (perItemProviderFailure(error)) {
            acc.unpricedItems.push(line.name);
            dedicatedError = undefined;
          }
          console.warn(
            `Live ${storeName} pricing failed for "${line.name}": ${errorMessage(error)}`
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
          source = "weekly_ad";
          return;
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
            source = "weekly_ad";
            return;
          }
        } catch (error) {
          const message = errorMessage(error);
          acc.errors.push(message);
          console.warn(
            `Weekly-ad ${storeName} pricing failed for "${line.name}": ${message}`
          );
        }
      } else if (flipp?.isConfigured() && !zip) {
        acc.configured = true;
        acc.errors.push(
          `${storeName} weekly-ad prices need a 5-digit US ZIP. ZIP+4 is accepted; only the first five digits are used. The circular is whatever Flipp publishes for that ZIP, not a live shelf price.`
        );
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
        return;
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
        source = "cached_live";
      } else if (weeklyFallback.length > 0) {
        add(weeklyFallback, line.name, "weekly_ad");
        acc.cachedWeeklyAdHits += 1;
        source = "weekly_ad";
      } else if (seedFallback.length > 0 && allowsDemoFallback(storeName)) {
        add(seedFallback, line.name, "seed");
        acc.seedHits += 1;
        source = "seed";
      }
      } finally {
        const elapsed = Date.now() - started;
        storeMs.set(storeName, (storeMs.get(storeName) || 0) + elapsed);
        const left = Math.max(0, (storeLeft.get(storeName) || 1) - 1);
        storeLeft.set(storeName, left);
        console.info(`price ${storeName} "${line.name}" ${elapsed}ms ${source}`);
        if (left === 0) {
          const still = [...storeLeft.entries()].filter(([, count]) => count > 0).map(([name]) => name);
          console.info(`price store ${storeName} ${storeMs.get(storeName) || elapsed}ms`);
          hooks?.onStore?.({
            storeName,
            ms: storeMs.get(storeName) || elapsed,
            pendingStores: still,
            products: products.slice(),
          });
        }
      }
      });
    }
  }

  const deadline = Date.now() + PRICE_BUDGET_MS;
  let cursor = 0;
  const pendingStores: string[] = [];
  async function priceWorker(): Promise<void> {
    while (cursor < jobs.length) {
      if (Date.now() >= deadline) return;
      const job = jobs[cursor];
      cursor += 1;
      await job();
    }
  }
  await Promise.all(Array.from({ length: Math.min(PRICE_POOL, Math.max(jobs.length, 1)) }, () => priceWorker()));
  if (cursor < jobs.length) {
    const skipped = new Set<string>();
    for (let index = cursor; index < jobs.length; index += 1) {
      const storeName = competing[index % competing.length];
      if (storeName) skipped.add(storeName);
    }
    pendingStores.push(...skipped);
    console.info(`price partial pending ${pendingStores.join(", ") || "stores"}`);
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
    ...(pendingStores.length ? { partial: true, pendingStores } : {}),
  };
}
