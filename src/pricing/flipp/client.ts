import { nameContainsAllTokens, groceryWordTokens } from "../../productSearchQuery";
import { envFlag } from "../envFlag";
import { StorePricingError } from "../types";
import {
  flippItemMatchesStore,
  groceryStoreNameForFlippMerchant,
  mappingForStore,
  type FlippMerchantMapping,
} from "./merchants";
import { parseFlippPrice } from "./parsePrice";
import { publishSale, saleEndDay } from "../saleFacts";

export const FLIPP_CONSUMER_SEARCH =
  "https://backflipp.wishabi.com/flipp/items/search";
export const FLIPP_FLYERS = "https://backflipp.wishabi.com/flipp/flyers";
export const FLIPP_FLYERKIT_BASE = "https://api.flipp.com/flyerkit/v4.0";

/** A merchant `AND term` search returns an empty `items` list. The circular is the flyer. */
const MAX_FLYERS_PER_STORE = 3;

export const FLIPP_USER_AGENT =
  "GroceryGitter/1.0 (+https://github.com/bbernhardt15/grocery-price-optimizer)";

const SEARCH_TIMEOUT_MS = 10_000;
const CACHE_MAX = 500;
/** Minimum gap between outbound Flipp calls. Tests can set this to 0. */
const DEFAULT_FLIPP_INTERVAL_MS = 250;

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
  categories?: string[];
};

type FlyerIndex =
  | { ok: true; flyers: FlippFlyerSummary[] }
  | { ok: false };

export type WeeklyAdBannerHit = {
  storeName: string;
  merchantName: string;
  merchantId?: number;
  flyerNames: string[];
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
  /** Flyer original price when it is higher than the sale price. */
  regularPrice?: number;
  /** Flyer valid_to day, when the circular sent one. */
  saleEndsOn?: string;
};

type CacheEntry = {
  expiresAt: number;
  items: FlippFlyerItem[];
};

const searchCache = new Map<string, CacheEntry>();
const flyerListCache = new Map<string, { expiresAt: number; flyers: FlippFlyerSummary[] }>();
const dealsCache = new Map<string, { expiresAt: number; deals: NormalizedFlippDeal[] }>();
const inflight = new Map<string, Promise<unknown>>();

let flippChain: Promise<void> = Promise.resolve();
let lastFlippStart = 0;

function flippIntervalMs(): number {
  const raw = process.env.FLIPP_MIN_INTERVAL_MS;
  if (raw == null || raw.trim() === "") {
    return DEFAULT_FLIPP_INTERVAL_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FLIPP_INTERVAL_MS;
}

function paceFlipp(): Promise<void> {
  const interval = flippIntervalMs();
  const run = flippChain.then(async () => {
    if (interval <= 0) {
      return;
    }
    const wait = lastFlippStart + interval - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastFlippStart = Date.now();
  });
  flippChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function nyDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

/** ISO week for the America/New_York calendar date. Circulars are cached per ZIP and this week. */
export function flippWeekKey(now = new Date()): string {
  const { year, month, day } = nyDateParts(now);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Keep a ZIP's circular until the next Monday morning Eastern, at least one hour. */
export function flippCacheExpiresAt(now = new Date()): number {
  const { year, month, day } = nyDateParts(now);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysUntilMonday = weekday === 0 ? 1 : 8 - weekday;
  const endOfWeek = Date.UTC(year, month - 1, day + daysUntilMonday, 5, 0, 0);
  return Math.max(endOfWeek, now.getTime() + 60 * 60 * 1000);
}

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
  searchCache.set(key, { expiresAt: flippCacheExpiresAt(new Date(now)), items });
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
  await paceFlipp();
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
  const key = `${zipCode}|${flippWeekKey()}|${query.toLowerCase()}`;
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

/** A plain dollar amount only. "2 for $5" and "Save $1" are not a was-price. */
function flyerWasPrice(item: FlippFlyerItem): number | undefined {
  const original = parseFlippPrice(item.original_price);
  if (original != null && original > 0) return original;
  const text = item.pre_price_text?.trim() ?? "";
  if (!/^\$?\s*\d+(?:\.\d{1,2})?$/.test(text)) return undefined;
  const parsed = parseFlippPrice(text);
  return parsed != null && parsed > 0 ? parsed : undefined;
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

  const sale = publishSale({
    price,
    onSale: true,
    regularPrice: flyerWasPrice(item),
    saleEndsOn: saleEndDay(item.valid_to),
  });

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
    ...(sale?.regularPrice != null ? { regularPrice: sale.regularPrice } : {}),
    ...(sale?.saleEndsOn ? { saleEndsOn: sale.saleEndsOn } : {}),
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

function flyerCacheKey(zipCode: string): string {
  return `${zipCode}|${flippWeekKey()}`;
}

function flyerRank(flyer: FlippFlyerSummary): number {
  const name = (flyer.name ?? "").toLowerCase();
  const categories = (flyer.categories ?? []).join(" ").toLowerCase();
  let score = 0;
  if (categories.includes("grocer")) {
    score += 4;
  }
  if (/weekly|circular|in[- ]store|ad\b/.test(name)) {
    score += 2;
  }
  if (/liquor|halloween|apparel|beauty/.test(name)) {
    score -= 3;
  }
  return score;
}

/**
 * Mapped grocery banners present in a flyer index. Unmapped merchants and
 * liquor circulars (Publix Liquors, and similar) are left out.
 */
export function weeklyAdBannersFromFlyers(
  flyers: Array<Pick<FlippFlyerSummary, "merchant" | "merchant_id" | "name">>
): WeeklyAdBannerHit[] {
  const byStore = new Map<string, WeeklyAdBannerHit>();
  for (const flyer of flyers) {
    const storeName = groceryStoreNameForFlippMerchant(
      flyer.merchant ?? "",
      flyer.merchant_id
    );
    if (!storeName) {
      continue;
    }
    const flyerName = flyer.name?.trim();
    const existing = byStore.get(storeName);
    if (!existing) {
      byStore.set(storeName, {
        storeName,
        merchantName: (flyer.merchant ?? storeName).trim() || storeName,
        ...(typeof flyer.merchant_id === "number" ? { merchantId: flyer.merchant_id } : {}),
        flyerNames: flyerName ? [flyerName] : [],
      });
      continue;
    }
    if (flyerName && !existing.flyerNames.includes(flyerName)) {
      existing.flyerNames.push(flyerName);
    }
  }
  return [...byStore.values()];
}

async function searchFlippFlyers(zipCode: string): Promise<FlyerIndex> {
  const key = flyerCacheKey(zipCode);
  const cached = flyerListCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, flyers: cached.flyers };
  }
  return withInflight(`flyers|${key}`, async () => {
    const again = flyerListCache.get(key);
    if (again && again.expiresAt > Date.now()) {
      return { ok: true, flyers: again.flyers };
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
    if (!Array.isArray(payload.flyers)) {
      return { ok: false };
    }
    flyerListCache.set(key, { expiresAt: flippCacheExpiresAt(), flyers: payload.flyers });
    return { ok: true, flyers: payload.flyers };
  });
}

/**
 * Which configured banners have a circular in Flipp's index for this ZIP.
 * One index request per ZIP per week. Does not download flyer pages.
 */
export async function listWeeklyAdBanners(
  zipCode: string | undefined
): Promise<WeeklyAdBannerHit[]> {
  const zip = zip5(zipCode);
  if (!zip || !flippConsumerEnabled()) {
    return [];
  }
  const index = await searchFlippFlyers(zip);
  if (!index.ok) {
    return [];
  }
  return weeklyAdBannersFromFlyers(index.flyers);
}

async function loadFlippFlyerItems(flyerId: number): Promise<FlippFlyerItem[]> {
  const key = `flyer|${flyerId}|${flippWeekKey()}`;
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
 * Full weekly circular for one banner near a ZIP. Cached per store, ZIP, and
 * ISO week. The flyer index is fetched once per ZIP per week and paced so a
 * browse does not burst one request per banner. A merchant that is absent
 * from that index is not searched again.
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

  const cacheKey = `${mapping.storeName}|${zip}|${flippWeekKey()}`;
  const cached = dealsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.deals;
  }

  return withInflight(`deals|${cacheKey}`, async () => {
    const again = dealsCache.get(cacheKey);
    if (again && again.expiresAt > Date.now()) {
      return again.deals;
    }

    const index = await searchFlippFlyers(zip);
    if (!index.ok) {
      return filterForStore(
        stampMerchant(await searchFlippConsumerItems(mapping.searchName, zip), mapping),
        mapping.storeName
      );
    }

    const picked = index.flyers
      .filter((flyer) =>
        flippItemMatchesStore(mapping.storeName, flyer.merchant ?? "", flyer.merchant_id)
      )
      .filter((flyer) => typeof flyer.id === "number")
      .sort((left, right) => flyerRank(right) - flyerRank(left) || (left.id ?? 0) - (right.id ?? 0))
      .slice(0, MAX_FLYERS_PER_STORE);

    const pages: FlippFlyerItem[][] = [];
    for (const flyer of picked) {
      const items = await loadFlippFlyerItems(flyer.id as number);
      pages.push(stampMerchant(items, mapping, flyer.merchant_id));
    }
    const deals = filterForStore(pages.flat(), mapping.storeName);
    dealsCache.set(cacheKey, { expiresAt: flippCacheExpiresAt(), deals });
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

  const index = flyerListCache.get(flyerCacheKey(zip));
  if (index && index.expiresAt > Date.now()) {
    return matched;
  }

  return filterForStore(await searchFlippConsumerItems(query, zip), mapping.storeName).filter(
    (deal) => weeklyAdNameMatches(deal.name, query)
  );
}
