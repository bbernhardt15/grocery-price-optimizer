import { nameContainsAllTokens, groceryWordTokens } from "../../productSearchQuery";
import { envFlag } from "../envFlag";
import { StorePricingError } from "../types";
import {
  flippItemMatchesStore,
  mappingForStore,
  type FlippMerchantMapping,
} from "./merchants";
import { parseFlippPrice } from "./parsePrice";

export const FLIPP_CONSUMER_SEARCH =
  "https://backflipp.wishabi.com/flipp/items/search";
export const FLIPP_FLYERS = "https://backflipp.wishabi.com/flipp/flyers";
export const FLIPP_FLYERKIT_BASE = "https://api.flipp.com/flyerkit/v4.0";

/** A merchant `AND term` search returns an empty `items` list. The circular is the flyer. */
const MAX_FLYERS_PER_STORE = 3;

export const FLIPP_USER_AGENT =
  "GroceryGitter/1.0 (+https://github.com/bbernhardt15/grocery-price-optimizer)";

const SEARCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 200;

export type FlippFlyerItem = {
  name?: string;
  current_price?: unknown;
  original_price?: unknown;
  pre_price_text?: string | null;
  post_price_text?: string | null;
  sale_story?: string | null;
  merchant_name?: string;
  merchant_id?: number;
  flyer_item_id?: number;
  id?: number;
  flyer_id?: number;
  valid_from?: string;
  valid_to?: string;
  brand?: string;
  /** Flyer detail uses `price` (often a string). Search uses `current_price`. */
  price?: unknown;
  clean_image_url?: string | null;
  clipping_image_url?: string | null;
  cutout_image_url?: string | null;
};

type FlippFlyerSummary = {
  id?: number;
  merchant_id?: number;
  merchant?: string;
  name?: string;
  valid_to?: string;
};

type FlippSearchResponse = {
  items?: FlippFlyerItem[];
  related_items?: FlippFlyerItem[];
  flyers?: FlippFlyerSummary[];
  error?: string;
  message?: string;
};

export type NormalizedFlippDeal = {
  name: string;
  brand: string;
  merchantName: string;
  merchantId?: number;
  price: number;
  flyerItemId?: string;
  postPriceText?: string;
  saleStory?: string;
  imageUrl?: string;
};

type CacheEntry = {
  expiresAt: number;
  items: FlippFlyerItem[];
};

const searchCache = new Map<string, CacheEntry>();
const flyerListCache = new Map<string, { expiresAt: number; flyers: FlippFlyerSummary[] }>();
const dealsCache = new Map<string, { expiresAt: number; deals: NormalizedFlippDeal[] }>();
const inflight = new Map<string, Promise<unknown>>();

export function flippAccessToken(): string {
  return process.env.FLIPP_ACCESS_TOKEN?.trim() ?? "";
}

export function flippConsumerEnabled(): boolean {
  return envFlag("FLIPP_ENABLED");
}

export function flippConfigured(): boolean {
  return Boolean(flippAccessToken()) || flippConsumerEnabled();
}

export function clearFlippSearchCache(): void {
  searchCache.clear();
  flyerListCache.clear();
  dealsCache.clear();
  inflight.clear();
}

/**
 * Whole-word match against a circular item. "milk" does not match Milk-Bone.
 * BOGO rows are dropped later when they have no dollar amount.
 */
export function weeklyAdNameMatches(name: string, term: string): boolean {
  const tokens = groceryWordTokens(term);
  if (tokens.length === 0 || !nameContainsAllTokens(name, tokens)) {
    return false;
  }
  if (tokens.length === 1 && tokens[0].toLowerCase() === "milk" && /milk[-\s]?bone/i.test(name)) {
    return false;
  }
  return true;
}

function pruneCache(now: number): void {
  if (searchCache.size <= CACHE_MAX) {
    return;
  }
  for (const [key, entry] of searchCache) {
    if (entry.expiresAt <= now) {
      searchCache.delete(key);
    }
  }
  if (searchCache.size <= CACHE_MAX) {
    return;
  }
  const oldest = searchCache.keys().next().value;
  if (oldest) {
    searchCache.delete(oldest);
  }
}

function cacheGet(key: string): FlippFlyerItem[] | undefined {
  const entry = searchCache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return undefined;
  }
  return entry.items;
}

function cacheSet(key: string, items: FlippFlyerItem[]): void {
  const now = Date.now();
  pruneCache(now);
  searchCache.set(key, { expiresAt: now + CACHE_TTL_MS, items });
}

function zip5(zipCode: string | undefined): string | undefined {
  const zip = zipCode?.trim().replace(/\D/g, "").slice(0, 5);
  return zip && /^\d{5}$/.test(zip) ? zip : undefined;
}

function stillValid(item: FlippFlyerItem, now = new Date()): boolean {
  if (!item.valid_to) {
    return true;
  }
  const until = Date.parse(item.valid_to);
  if (Number.isNaN(until)) {
    return true;
  }
  return until >= now.getTime();
}

async function flippGet(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      method: "GET",
      cache: "no-cache",
      headers: {
        Accept: "application/json",
        "User-Agent": FLIPP_USER_AGENT,
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StorePricingError(
      "Flipp",
      `Flipp deals lookup unavailable (${message})`,
      "network"
    );
  }
}

function errorPayload(payload: FlippSearchResponse, status: number): string {
  return (
    payload.message ||
    payload.error ||
    `Flipp deals lookup failed (${status})`
  );
}

/**
 * Official FlyerKit v4.0 (https://api.flipp.com/flyerkit/v4.0/documentation).
 * Requires an access_token issued by a Flipp technical contact. Tokens are
 * typically merchant-scoped, so this is a secondary path to the consumer
 * search used when `FLIPP_ENABLED=true`.
 */
export async function searchFlyerKitProducts(
  mapping: FlippMerchantMapping,
  term: string,
  zipCode: string,
  token: string
): Promise<FlippFlyerItem[]> {
  const params = new URLSearchParams({
    access_token: token,
    locale: "en-US",
    postal_code: zipCode,
    keywords: term,
  });
  const url = `${FLIPP_FLYERKIT_BASE}/publications/${encodeURIComponent(
    mapping.flyerKitSlug
  )}/products?${params.toString()}`;
  const response = await flippGet(url);
  const payload = (await response.json().catch(() => ({}))) as
    | FlippFlyerItem[]
    | FlippSearchResponse;

  if (!response.ok) {
    const asObj = Array.isArray(payload) ? {} : payload;
    throw new StorePricingError(
      "Flipp",
      errorPayload(asObj, response.status),
      "http"
    );
  }

  if (Array.isArray(payload)) {
    return payload;
  }
  const rows = (payload as { products?: FlippFlyerItem[] }).products;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Flipp consumer flyer-item search used by flipp.com.
 * Not FlyerKit: no documented partner contract, no access_token. Gate with
 * `FLIPP_ENABLED=true` and do not treat this as a retailer shelf API.
 */
export async function searchFlippConsumerItems(
  query: string,
  zipCode: string
): Promise<FlippFlyerItem[]> {
  const key = `${zipCode}|${query.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) {
    return cached;
  }

  const params = new URLSearchParams({
    locale: "en-us",
    postal_code: zipCode,
    q: query,
  });
  const url = `${FLIPP_CONSUMER_SEARCH}?${params.toString()}`;
  const response = await flippGet(url);
  const payload = (await response.json().catch(() => ({}))) as FlippSearchResponse;
  if (!response.ok) {
    throw new StorePricingError("Flipp", errorPayload(payload, response.status), "http");
  }

  const items = mergeFlyerItems(payload.items, payload.related_items);
  cacheSet(key, items);
  return items;
}

function mergeFlyerItems(
  primary: FlippFlyerItem[] | undefined,
  extra: FlippFlyerItem[] | undefined
): FlippFlyerItem[] {
  const merged: FlippFlyerItem[] = [];
  const seen = new Set<string>();
  for (const item of [...(primary ?? []), ...(extra ?? [])]) {
    const id =
      item.flyer_item_id != null
        ? String(item.flyer_item_id)
        : item.id != null
          ? String(item.id)
          : `${item.merchant_id ?? ""}|${item.name ?? ""}|${String(item.current_price ?? item.price ?? "")}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(item);
  }
  return merged;
}

function flyerPrice(item: FlippFlyerItem): unknown {
  if (item.current_price != null && item.current_price !== "") {
    return item.current_price;
  }
  return item.price;
}

function httpsImage(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("http://")) {
    return `https://${trimmed.slice("http://".length)}`;
  }
  return undefined;
}

export function normalizeFlippDeal(
  item: FlippFlyerItem,
  storeName: string
): NormalizedFlippDeal | null {
  const name = item.name?.trim();
  const price = parseFlippPrice(flyerPrice(item));
  if (!name || price === null) {
    return null;
  }
  if (!stillValid(item)) {
    return null;
  }

  const merchantName = item.merchant_name?.trim() || storeName;
  const flyerItemId =
    item.flyer_item_id != null
      ? String(item.flyer_item_id)
      : item.id != null
        ? String(item.id)
        : undefined;
  const imageUrl = httpsImage(
    item.clean_image_url || item.clipping_image_url || item.cutout_image_url
  );

  return {
    name,
    brand: item.brand?.trim() || merchantName,
    merchantName,
    ...(typeof item.merchant_id === "number" ? { merchantId: item.merchant_id } : {}),
    price,
    ...(flyerItemId ? { flyerItemId } : {}),
    ...(item.post_price_text?.trim()
      ? { postPriceText: item.post_price_text.trim() }
      : {}),
    ...(item.sale_story?.trim() ? { saleStory: item.sale_story.trim() } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

function filterForStore(
  items: FlippFlyerItem[],
  storeName: string
): NormalizedFlippDeal[] {
  const deals: NormalizedFlippDeal[] = [];
  for (const item of items) {
    const merchantName = item.merchant_name ?? "";
    if (!flippItemMatchesStore(storeName, merchantName, item.merchant_id)) {
      continue;
    }
    const deal = normalizeFlippDeal(item, storeName);
    if (deal) {
      deals.push(deal);
    }
  }
  return deals;
}

async function withInflight<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }
  const promise = loader().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

async function searchFlippFlyers(zipCode: string): Promise<FlippFlyerSummary[]> {
  const cached = flyerListCache.get(zipCode);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.flyers;
  }
  return withInflight(`flyers|${zipCode}`, async () => {
    const again = flyerListCache.get(zipCode);
    if (again && again.expiresAt > Date.now()) {
      return again.flyers;
    }
    const url = `${FLIPP_FLYERS}?${new URLSearchParams({
      locale: "en-us",
      postal_code: zipCode,
    }).toString()}`;
    const response = await flippGet(url);
    const payload = (await response.json().catch(() => ({}))) as FlippSearchResponse;
    if (!response.ok) {
      throw new StorePricingError("Flipp", errorPayload(payload, response.status), "http");
    }
    const flyers = Array.isArray(payload.flyers) ? payload.flyers : [];
    flyerListCache.set(zipCode, { expiresAt: Date.now() + CACHE_TTL_MS, flyers });
    return flyers;
  });
}

async function loadFlippFlyerItems(flyerId: number): Promise<FlippFlyerItem[]> {
  const key = `flyer|${flyerId}`;
  const cached = cacheGet(key);
  if (cached) {
    return cached;
  }
  return withInflight(key, async () => {
    const again = cacheGet(key);
    if (again) {
      return again;
    }
    const url = `${FLIPP_FLYERS}/${flyerId}?locale=en-us`;
    const response = await flippGet(url);
    const payload = (await response.json().catch(() => ({}))) as FlippSearchResponse;
    if (!response.ok) {
      throw new StorePricingError("Flipp", errorPayload(payload, response.status), "http");
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    cacheSet(key, items);
    return items;
  });
}

function stampMerchant(
  items: FlippFlyerItem[],
  mapping: FlippMerchantMapping,
  merchantId?: number
): FlippFlyerItem[] {
  return items.map((item) => ({
    ...item,
    merchant_name: item.merchant_name?.trim() || mapping.searchName,
    merchant_id: typeof item.merchant_id === "number" ? item.merchant_id : merchantId,
  }));
}

/**
 * Full weekly circular for one banner near a ZIP. Cached per store and ZIP.
 * `q="{merchant} AND {term}"` returns no `items` on the consumer search, so
 * trip planning and browse read the flyer and match the grocery words locally.
 * Requires `FLIPP_ENABLED`. Does not call Flipp when that flag is off.
 */
export async function loadWeeklyAdDeals(
  storeName: string,
  zipCode: string | undefined
): Promise<NormalizedFlippDeal[]> {
  const mapping = mappingForStore(storeName);
  const zip = zip5(zipCode);
  if (!mapping || !zip || !flippConsumerEnabled()) {
    return [];
  }

  const cacheKey = `${mapping.storeName}|${zip}`;
  const cached = dealsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.deals;
  }

  return withInflight(`deals|${cacheKey}`, async () => {
    const again = dealsCache.get(cacheKey);
    if (again && again.expiresAt > Date.now()) {
      return again.deals;
    }

    let deals: NormalizedFlippDeal[] = [];
    const flyers = (await searchFlippFlyers(zip)).filter((flyer) =>
      flippItemMatchesStore(mapping.storeName, flyer.merchant ?? "", flyer.merchant_id)
    );
    const picked = flyers.filter((flyer) => typeof flyer.id === "number").slice(0, MAX_FLYERS_PER_STORE);
    if (picked.length > 0) {
      const pages = await Promise.all(
        picked.map(async (flyer) => {
          const items = await loadFlippFlyerItems(flyer.id as number);
          return stampMerchant(items, mapping, flyer.merchant_id);
        })
      );
      deals = filterForStore(pages.flat(), mapping.storeName);
    }

    if (deals.length === 0) {
      deals = filterForStore(
        stampMerchant(await searchFlippConsumerItems(mapping.searchName, zip), mapping),
        mapping.storeName
      );
    }

    dealsCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, deals });
    return deals;
  });
}

/**
 * Search weekly-ad flyer items for one Grocery Gitter store near a ZIP.
 * Prefers FlyerKit when a token is set; otherwise (or on miss/error) uses the
 * opt-in consumer circular for that ZIP.
 */
export async function searchFlippDealsForStore(
  storeName: string,
  term: string,
  zipCode: string | undefined
): Promise<NormalizedFlippDeal[]> {
  const mapping = mappingForStore(storeName);
  const query = term.trim();
  const zip = zip5(zipCode);
  if (!mapping || !query || !zip) {
    return [];
  }

  const token = flippAccessToken();
  if (token) {
    try {
      const flyerKit = await searchFlyerKitProducts(mapping, query, zip, token);
      const fromKit = filterForStore(
        flyerKit.map((item) => ({
          ...item,
          merchant_name: item.merchant_name || mapping.searchName,
        })),
        mapping.storeName
      );
      if (fromKit.length > 0) {
        return fromKit;
      }
    } catch (error) {
      if (!flippConsumerEnabled()) {
        throw error;
      }
    }
  }

  if (!flippConsumerEnabled()) {
    return [];
  }

  const circular = await loadWeeklyAdDeals(mapping.storeName, zip);
  const matched = circular.filter((deal) => weeklyAdNameMatches(deal.name, query));
  if (matched.length > 0 || circular.length > 0) {
    return matched;
  }

  return filterForStore(await searchFlippConsumerItems(query, zip), mapping.storeName).filter(
    (deal) => weeklyAdNameMatches(deal.name, query)
  );
}
