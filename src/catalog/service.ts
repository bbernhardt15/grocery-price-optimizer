import mongoose from "mongoose";
import { demoBrowseProducts, demoRecords } from "./demoCatalog";
import { catalogCoverage, type CoverageFlags } from "./coverage";
import { facetsFor, filterProducts, paginateProducts, sortProducts } from "./browse";
import { groupOffersByUpc } from "./normalize";
import { fetchKrogerDepartment, fetchKrogerSearch } from "./providers/krogerBrowse";
import { fetchWalmartDepartment, fetchWalmartSearch } from "./providers/walmartBrowse";
import { gapsForProduct } from "./substitutes";
import type { BrowseProduct, BrowseSort, CatalogGap, RawCatalogRecord, SizeClass, StoreCoverage } from "./types";
import { CatalogCache } from "../models/CatalogCache";
import { krogerService } from "../krogerService";
import { upsertLiveProducts } from "../priceCache";
import { krogerApiConfigured } from "../pricing/krogerProvider";
import { partnerProvidersFromEnv, partnerStoreNamesFromEnv } from "../pricing/partnerProviders";
import { parseGroceryUnit } from "../pricing/parseGroceryUnit";
import { targetPricingProvider } from "../pricing/targetProvider";
import { walmartPricingProvider } from "../pricing/walmartProvider";
import { rawFromCatalogProduct } from "./providers/fromCatalogProduct";
import type { CatalogProduct } from "../optimizeGroceryList";
import { searchTermsFor } from "./searchTerms";

const GAP_STORES = ["Aldi", "Kroger", "Target", "Walmart"];
const memoryCache = new Map<string, { expiresAt: number; products: BrowseProduct[]; warnings: string[] }>();

export type BrowseQuery = {
  query?: string;
  departmentId?: string;
  subcategory?: string;
  store?: string;
  brand?: string;
  onSale?: boolean;
  storeBrand?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sizeClass?: SizeClass;
  sort?: BrowseSort;
  limit?: number;
  cursor?: string;
  zipCode?: string;
};

export type BrowsePage = {
  items: Array<BrowseProduct & { gaps: CatalogGap[] }>;
  total: number;
  nextCursor: string | null;
  facets: ReturnType<typeof facetsFor>;
  coverage: StoreCoverage[];
  warnings: string[];
  cached: boolean;
  catalogSource: "demo" | "mixed" | "live";
};

function ttlMs(envName: string, fallbackMinutes: number): number {
  const raw = Number(process.env[envName]);
  if (Number.isFinite(raw) && raw >= 5 && raw <= 7 * 24 * 60) {
    return raw * 60 * 1000;
  }
  return fallbackMinutes * 60 * 1000;
}

function flippEnabled(): boolean {
  return process.env.FLIPP_ENABLED?.trim().toLowerCase() === "true" || Boolean(process.env.FLIPP_ACCESS_TOKEN?.trim());
}

export function coverageFlags(): CoverageFlags {
  return {
    kroger: krogerApiConfigured(),
    walmart: walmartPricingProvider.isConfigured(),
    targetPartner: targetPricingProvider.isConfigured(),
    flipp: flippEnabled(),
    partnerStores: partnerStoreNamesFromEnv(),
  };
}

function providerSignature(): string {
  const flags = coverageFlags();
  return [
    flags.kroger ? "k" : "",
    flags.walmart ? "w" : "",
    flags.targetPartner ? "t" : "",
    flags.flipp ? "f" : "",
    ...flags.partnerStores.map((store) => store.toLowerCase()),
  ].join("|");
}

function liveConfigured(): boolean {
  const flags = coverageFlags();
  return flags.kroger || flags.walmart || flags.targetPartner || flags.partnerStores.length > 0;
}

function catalogSourceOf(products: BrowseProduct[]): "demo" | "mixed" | "live" {
  let live = false;
  let seed = false;
  for (const product of products) {
    for (const offer of product.offers) {
      if (offer.priceSource === "seed") {
        seed = true;
      } else {
        live = true;
      }
    }
  }
  if (live && seed) return "mixed";
  if (live) return "live";
  return "demo";
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function demoRecordsFor(scope: { departmentId?: string; query?: string }): RawCatalogRecord[] {
  const tokens = queryTokens(scope.query ?? "");
  return demoRecords().filter((record) => {
    if (scope.departmentId && record.departmentId !== scope.departmentId) {
      return false;
    }
    if (tokens.length === 0) {
      return !scope.query;
    }
    const text = `${record.name} ${record.brand}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
}

async function krogerLocation(zipCode?: string): Promise<string | undefined> {
  if (!zipCode || !krogerApiConfigured()) {
    return undefined;
  }
  try {
    return await krogerService.getClosestStoreLocation(zipCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Kroger location lookup failed during browse: ${message}`);
    return undefined;
  }
}

async function persistLive(records: RawCatalogRecord[]): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    return;
  }
  const products: CatalogProduct[] = [];
  for (const record of records) {
    if (record.priceSource !== "live") {
      continue;
    }
    const unit = parseGroceryUnit(record.size);
    products.push({
      name: record.name,
      brand: record.brand || record.storeName,
      storeName: record.storeName,
      price: record.price,
      unit,
      normalizedUnit: unit,
      ...(record.size ? { size: record.size } : {}),
      ...(record.upc ? { upc: record.upc } : {}),
      ...(record.productId ? { productId: record.productId } : {}),
      ...(record.locationId ? { locationId: record.locationId } : {}),
      priceSource: "live",
    });
  }
  if (products.length === 0) {
    return;
  }
  try {
    await upsertLiveProducts(products);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Browse catalog cache upsert failed: ${message}`);
  }
}

async function searchFeed(
  query: string,
  zipCode: string | undefined,
  locationId: string | undefined,
  warnings: string[]
): Promise<RawCatalogRecord[]> {
  const records: RawCatalogRecord[] = [];
  if (walmartPricingProvider.isConfigured()) {
    try {
      records.push(...(await fetchWalmartSearch(query, zipCode)));
    } catch (error) {
      warnings.push(`Walmart browse search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (krogerApiConfigured()) {
    try {
      records.push(...(await fetchKrogerSearch(query, locationId)));
    } catch (error) {
      warnings.push(`Kroger browse search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (targetPricingProvider.isConfigured()) {
    try {
      const products = await targetPricingProvider.searchProducts(query, { zipCode });
      for (const product of products) {
        const raw = rawFromCatalogProduct(product, "partner_feed");
        if (raw) records.push(raw);
      }
    } catch (error) {
      warnings.push(`Target partner search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const provider of partnerProvidersFromEnv()) {
    try {
      const products = await provider.searchProducts(query, { zipCode });
      for (const product of products) {
        const raw = rawFromCatalogProduct({ ...product, storeName: provider.storeName }, "partner_feed");
        if (raw) records.push(raw);
      }
    } catch (error) {
      warnings.push(
        `${provider.storeName} partner search failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return records;
}

async function departmentFeed(
  departmentId: string,
  zipCode: string | undefined,
  locationId: string | undefined,
  warnings: string[]
): Promise<RawCatalogRecord[]> {
  const records: RawCatalogRecord[] = [];
  if (walmartPricingProvider.isConfigured()) {
    try {
      records.push(...(await fetchWalmartDepartment(departmentId, zipCode)));
    } catch (error) {
      warnings.push(`Walmart category browse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (krogerApiConfigured()) {
    try {
      records.push(...(await fetchKrogerDepartment(departmentId, locationId)));
    } catch (error) {
      warnings.push(`Kroger department search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const terms = searchTermsFor(departmentId);
  if (targetPricingProvider.isConfigured()) {
    for (const term of terms) {
      try {
        const products = await targetPricingProvider.searchProducts(term, { zipCode });
        for (const product of products) {
          const raw = rawFromCatalogProduct(product, "partner_feed");
          if (raw) records.push(raw);
        }
      } catch (error) {
        warnings.push(`Target partner search failed: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
  }
  for (const provider of partnerProvidersFromEnv()) {
    for (const term of terms.slice(0, 1)) {
      try {
        const products = await provider.searchProducts(term, { zipCode });
        for (const product of products) {
          const raw = rawFromCatalogProduct({ ...product, storeName: provider.storeName }, "partner_feed");
          if (raw) records.push(raw);
        }
      } catch (error) {
        warnings.push(
          `${provider.storeName} partner search failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  return records;
}

async function readCache(cacheKey: string): Promise<{ products: BrowseProduct[]; warnings: string[] } | null> {
  const memory = memoryCache.get(cacheKey);
  if (memory && memory.expiresAt > Date.now()) {
    return { products: memory.products, warnings: memory.warnings };
  }
  if (mongoose.connection.readyState !== 1) {
    return null;
  }
  const doc = await CatalogCache.findOne({ cacheKey, expiresAt: { $gt: new Date() } }).lean<{
    products?: BrowseProduct[];
    warnings?: string[];
  } | null>();
  if (!doc || !Array.isArray(doc.products)) {
    return null;
  }
  memoryCache.set(cacheKey, {
    expiresAt: Date.now() + 60_000,
    products: doc.products,
    warnings: doc.warnings ?? [],
  });
  return { products: doc.products, warnings: doc.warnings ?? [] };
}

async function writeCache(
  cacheKey: string,
  products: BrowseProduct[],
  warnings: string[],
  ttl: number
): Promise<void> {
  memoryCache.set(cacheKey, { expiresAt: Date.now() + ttl, products, warnings });
  if (mongoose.connection.readyState !== 1) {
    return;
  }
  const expiresAt = new Date(Date.now() + ttl);
  await CatalogCache.findOneAndUpdate(
    { cacheKey },
    { $set: { products, warnings, expiresAt } },
    { upsert: true }
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Catalog cache write failed: ${message}`);
  });
}

async function loadScope(
  scope: { departmentId?: string; query?: string },
  zipCode?: string
): Promise<{ products: BrowseProduct[]; warnings: string[]; cached: boolean }> {
  const query = scope.query?.trim();
  const departmentId = scope.departmentId?.trim();
  const demo = demoRecordsFor({
    ...(departmentId ? { departmentId } : {}),
    ...(query ? { query } : {}),
  });

  const wantsLive = liveConfigured() && (Boolean(departmentId) || Boolean(query && query.length >= 2));
  if (!wantsLive) {
    return { products: groupOffersByUpc(demo), warnings: [], cached: false };
  }

  const cacheKey = [
    "browse",
    providerSignature(),
    zipCode ?? "none",
    departmentId ?? "all",
    query ? query.toLowerCase() : "",
  ].join(":");
  const cached = await readCache(cacheKey);
  if (cached) {
    return { products: cached.products, warnings: cached.warnings, cached: true };
  }

  const warnings: string[] = [];
  const locationId = await krogerLocation(zipCode);
  const live = query
    ? await searchFeed(query, zipCode, locationId, warnings)
    : await departmentFeed(departmentId ?? "", zipCode, locationId, warnings);
  const products = groupOffersByUpc([...demo, ...live]);
  const ttl = query ? ttlMs("CATALOG_SEARCH_TTL_MINUTES", 60) : ttlMs("CATALOG_DEPT_TTL_MINUTES", 360);
  await writeCache(cacheKey, products, warnings, ttl);
  await persistLive(live);
  return { products, warnings, cached: false };
}

export async function loadKnownProducts(): Promise<BrowseProduct[]> {
  const byId = new Map<string, BrowseProduct>();
  for (const product of demoBrowseProducts()) {
    byId.set(product.id, product);
  }
  for (const entry of memoryCache.values()) {
    if (entry.expiresAt <= Date.now()) {
      continue;
    }
    for (const product of entry.products) {
      byId.set(product.id, product);
    }
  }
  if (mongoose.connection.readyState === 1) {
    const docs = await CatalogCache.find({ expiresAt: { $gt: new Date() } })
      .lean<Array<{ products?: BrowseProduct[] }>>();
    for (const doc of docs) {
      if (!Array.isArray(doc.products)) {
        continue;
      }
      for (const product of doc.products) {
        if (product?.id) {
          byId.set(product.id, product);
        }
      }
    }
  }
  return [...byId.values()];
}

export async function browseCatalog(request: BrowseQuery): Promise<BrowsePage> {
  const query = request.query?.trim();
  const departmentId = request.departmentId?.trim();
  const scope = await loadScope(
    {
      ...(departmentId && departmentId !== "all" ? { departmentId } : {}),
      ...(query ? { query } : {}),
    },
    request.zipCode
  );

  const filters = {
    ...(query ? { query } : {}),
    ...(departmentId && departmentId !== "all" ? { departmentId } : {}),
    ...(request.subcategory ? { subcategory: request.subcategory } : {}),
    ...(request.store ? { store: request.store } : {}),
    ...(request.brand ? { brand: request.brand } : {}),
    ...(request.onSale ? { onSale: true } : {}),
    ...(request.storeBrand ? { storeBrand: true } : {}),
    ...(request.minPrice !== undefined ? { minPrice: request.minPrice } : {}),
    ...(request.maxPrice !== undefined ? { maxPrice: request.maxPrice } : {}),
    ...(request.sizeClass ? { sizeClass: request.sizeClass } : {}),
  };
  const facetPool = filterProducts(scope.products, {
    ...(query ? { query } : {}),
    ...(departmentId && departmentId !== "all" ? { departmentId } : {}),
  });
  const filtered = filterProducts(scope.products, filters);
  const sort = request.sort ?? (query ? "relevance" : "price");
  const sorted = sortProducts(filtered, sort, filters);
  const offset = Number(request.cursor ?? "0");
  const limit = Math.min(Math.max(request.limit ?? 24, 1), 48);
  const page = paginateProducts(sorted, offset, limit);
  const items = page.items.map((product) => ({
    ...product,
    gaps: gapsForProduct(product, scope.products, GAP_STORES),
  }));

  return {
    items,
    total: page.total,
    nextCursor: page.nextCursor,
    facets: facetsFor(facetPool),
    coverage: catalogCoverage(coverageFlags()),
    warnings: scope.warnings,
    cached: scope.cached,
    catalogSource: catalogSourceOf(scope.products),
  };
}

export async function suggestCatalog(query: string, limit = 8): Promise<BrowseProduct[]> {
  const q = query.trim();
  if (q.length < 1) {
    return [];
  }
  const known = await loadKnownProducts();
  const matches = sortProducts(filterProducts(known, { query: q }), "relevance", { query: q });
  return matches.slice(0, Math.min(Math.max(limit, 1), 12));
}

export async function getBrowseProduct(id: string): Promise<(BrowseProduct & { gaps: CatalogGap[] }) | null> {
  const known = await loadKnownProducts();
  const product = known.find((entry) => entry.id === id);
  if (!product) {
    return null;
  }
  return { ...product, gaps: gapsForProduct(product, known, GAP_STORES) };
}

export function resetBrowseMemoryCache(): void {
  memoryCache.clear();
}
