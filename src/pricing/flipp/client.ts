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
export const FLIPP_FLYERKIT_BASE = "https://api.flipp.com/flyerkit/v4.0";

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
};

type FlippSearchResponse = {
  items?: FlippFlyerItem[];
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
};

type CacheEntry = {
  expiresAt: number;
  items: FlippFlyerItem[];
};

const searchCache = new Map<string, CacheEntry>();

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

  const items = Array.isArray(payload.items) ? payload.items : [];
  cacheSet(key, items);
  return items;
}

export function normalizeFlippDeal(
  item: FlippFlyerItem,
  storeName: string
): NormalizedFlippDeal | null {
  const name = item.name?.trim();
  const price = parseFlippPrice(item.current_price);
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

/**
 * Search weekly-ad flyer items for one Grocery Gitter store near a ZIP.
 * Prefers FlyerKit when a token is set; otherwise (or on miss/error) uses the
 * opt-in consumer search.
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

  const merchantQuery = `${mapping.searchName} AND ${query}`;
  const targeted = filterForStore(
    await searchFlippConsumerItems(merchantQuery, zip),
    mapping.storeName
  );
  if (targeted.length > 0) {
    return targeted;
  }

  return filterForStore(
    await searchFlippConsumerItems(query, zip),
    mapping.storeName
  );
}
