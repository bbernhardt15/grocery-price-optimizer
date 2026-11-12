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
import { shouldStreamReview } from "./pricing/reviewStream";
import { runStorePools } from "./pricing/storePool";
import { findFreshUpcPrices } from "./pricing/freshCatalogPrice";
import { createLookupBudget, interleaveByStore, runPricedLookup, stableLineKey } from "./pricing/lookupBudget";
import { krogerService } from "./krogerService";
import { KROGER_PRODUCT_ID_BATCH } from "./ingest/krogerBatch";
import { krogerRequestId } from "./catalog/normalize";

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
/** Return what we have inside the time a phone will wait. Partials stream before this. */
const PRICE_BUDGET_MS = 9_000;
/** Name searches still run a few at a time. Known UPCs go out as one product-id batch. */
const PRICE_POOL = 8;

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
    onProgress?: (info: { storeName: string; checked: number; total: number; pendingStores: string[] }) => void;
    onSnapshot?: (info: { storeName: string; checked: number; total: number; pendingStores: string[]; products: CatalogProduct[] }) => void;
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
  const requestCache = new Map<string, CatalogProduct[]>();
  const budget = createLookupBudget(Date.now(), { deadlineMs: PRICE_BUDGET_MS });
  const krogerBatch = new Map<string, CatalogProduct[]>();
  if (competing.some((name) => name.trim().toLowerCase() === "kroger") && locationId) {
    const wanted: Array<{ name: string; upc: string }> = [];
    for (const line of lines) {
      const upc = hooks?.upcByName?.get(line.name.toLowerCase()) || "";
      if (upc) wanted.push({ name: line.name, upc });
    }
    for (let index = 0; index < wanted.length && Date.now() < budget.deadlineAt; index += KROGER_PRODUCT_ID_BATCH) {
      const slice = wanted.slice(index, index + KROGER_PRODUCT_ID_BATCH);
      try {
        const page = await krogerService.productsByIds(slice.map((row) => row.upc), locationId);
        for (const row of slice) {
          const wantedId = krogerRequestId(row.upc);
          const hits = page.products.filter((product) => {
            const productId = krogerRequestId(product.productId);
            const upc = krogerRequestId(product.upc);
            return Boolean(wantedId && (productId === wantedId || upc === wantedId));
          });
          if (hits.length) krogerBatch.set(row.name.toLowerCase(), hits);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.info(`price Kroger batch ${message}`);
        break;
      }
    }
  }
  for (const storeName of competing) storeLeft.set(storeName, lines.length);
  const jobs: Array<{ storeName: string; lineName: string; run: () => Promise<void> }> = [];
  // One store's lines run before the next so the first store can stream
  // while the others are still in the 9-second budget.
  for (const storeName of competing) {
    for (const line of lines) {
      jobs.push({ storeName, lineName: line.name, run: async () => {
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

      const upc = hooks?.upcByName?.get(line.name.toLowerCase()) || "";
      const batched = storeName.trim().toLowerCase() === "kroger" ? krogerBatch.get(line.name.toLowerCase()) : undefined;
      if (batched?.length) {
        add(batched, line.name, "live");
        acc.liveHits += 1;
        source = "batch";
        return;
      }
      if (upc) {
        const fresh = await findFreshUpcPrices({ storeName, upc, locationId: krogerId, zip });
        if (fresh.length > 0) {
          add(fresh, line.name, "cached_live");
          acc.cachedHits += 1;
          source = "fresh-upc";
          return;
        }
      }

      const requestKey = `${storeName.trim().toLowerCase()}|${zip || ""}|${upc}|${stableLineKey(line.name)}`;
      const remembered = requestCache.get(requestKey);
      if (remembered?.length) {
        add(remembered, line.name, remembered[0]?.priceSource === "weekly_ad" ? "weekly_ad" : "cached_live");
        acc.cachedHits += 1;
        source = "request-cache";
        return;
      }

      let dedicatedError: string | undefined;
      if (dedicated?.isConfigured()) {
        acc.configured = true;
        acc.attempted = true;
        const outcome = await runPricedLookup({
          budget,
          storeName,
          run: () =>
            searchWithProvider(
              dedicated,
              storeName,
              line.name,
              zipCode,
              locationId,
              hooks?.upcByName?.get(line.name.toLowerCase())
            ),
        });
        if (outcome.status === "ok") {
          const live = outcome.products;
          requestCache.set(requestKey, live);
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
        if (outcome.status === "failed" || outcome.status === "budget") {
          const transient = outcome.status === "budget" || outcome.kind === "timeout" || outcome.kind === "rate_limit";
          if (outcome.status === "failed" && perItemProviderFailure(outcome.error)) {
            acc.unpricedItems.push(line.name);
          } else if (transient) {
            acc.check = outcome.status === "budget" ? "timeout" : outcome.kind;
            acc.uncheckedItems.push(line.name);
            if (outcome.status === "failed" && outcome.message) {
              console.warn(`Live ${storeName} pricing failed for "${line.name}": ${outcome.message}`);
            }
          } else if (outcome.status === "failed") {
            dedicatedError = outcome.message;
            console.warn(`Live ${storeName} pricing failed for "${line.name}": ${outcome.message}`);
          }
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

        if (Date.now() < budget.deadlineAt) {
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
      if (source !== "miss") {
        acc.uncheckedItems = acc.uncheckedItems.filter((name) => name !== line.name);
        if (acc.uncheckedItems.length === 0) acc.check = undefined;
      }
      } finally {
        const elapsed = Date.now() - started;
        storeMs.set(storeName, (storeMs.get(storeName) || 0) + elapsed);
        const left = Math.max(0, (storeLeft.get(storeName) || 1) - 1);
        storeLeft.set(storeName, left);
        const total = lines.length;
        const still = [...storeLeft.entries()].filter(([, count]) => count > 0).map(([name]) => name);
        const checked = total - left;
        hooks?.onProgress?.({
          storeName,
          checked,
          total,
          pendingStores: still,
        });
        if (shouldStreamReview(checked, total)) {
          hooks?.onSnapshot?.({
            storeName,
            checked,
            total,
            pendingStores: still,
            products: products.slice(),
          });
        }
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
      },
      });
    }
  }

  const orderedJobs = interleaveByStore(jobs);
  const pendingStores: string[] = [];
  function noteSkipped(storeName: string, lineName: string): void {
    const acc = accFor(storeName);
    if (!acc.check) acc.check = "timeout";
    acc.uncheckedItems.push(lineName);
    if (!pendingStores.includes(storeName)) pendingStores.push(storeName);
  }
  await runStorePools(orderedJobs, (job) => job.run(), {
    leadPool: PRICE_POOL,
    walmartPool: 4,
    walmartGraceMs: 6_000,
    onSkip: (job) => noteSkipped(job.storeName, job.lineName),
  });
  if (pendingStores.length) console.info(`price partial pending ${pendingStores.join(", ")}`);

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
