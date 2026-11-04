import type { CatalogProduct } from "../optimizeGroceryList";

export type StorePricingSource =
  | "live"
  | "cached_live"
  | "weekly_ad"
  | "cached_weekly_ad"
  | "partner_feed"
  | "seed"
  | "mixed"
  | "unavailable";

/** How the live rows were obtained. Partner feeds are licensed, not public retailer APIs. */
export type PricingFeedKind = "retailer_api" | "partner_feed";

export type PricingContext = {
  zipCode?: string;
  /** Kroger Locations API store id when a ZIP was provided. */
  locationId?: string;
  /** UPC to look up directly when the store supports it (Kroger uses the 13-digit form). */
  upc?: string;
};

export class StorePricingError extends Error {
  readonly storeName: string;
  readonly code: "missing_credentials" | "http" | "network" | "not_available";
  readonly status?: number;
  /** Response body, trimmed. No Authorization header. */
  readonly body?: string;
  /** Retry-After and rate-limit headers captured from a 429. */
  readonly headers?: Record<string, string>;

  constructor(
    storeName: string,
    message: string,
    code: "missing_credentials" | "http" | "network" | "not_available" = "http",
    status?: number,
    extras?: { body?: string; headers?: Record<string, string> }
  ) {
    super(message);
    this.name = "StorePricingError";
    this.storeName = storeName;
    this.code = code;
    this.status = status;
    this.body = extras?.body;
    this.headers = extras?.headers;
  }
}

/**
 * One retailer price source. Implementations must not scrape authenticated
 * storefronts; they call a documented API/feed or report that live prices
 * are unavailable.
 */
export type StorePricingProvider = {
  readonly storeName: string;
  /** Defaults to retailer_api (Kroger, Walmart). Licensed stubs set partner_feed. */
  readonly feedKind?: PricingFeedKind;
  isConfigured(): boolean;
  /** What to set in `.env` (or why live prices cannot exist). */
  setupHint(): string;
  searchProducts(
    term: string,
    context?: PricingContext
  ): Promise<CatalogProduct[]>;
};

export type StorePricingReport = {
  storeName: string;
  source: StorePricingSource;
  configured: boolean;
  attempted: boolean;
  ok: boolean;
  usedFallback: boolean;
  /** Shopper-facing label: Live prices / Partner feed / Cached live / Weekly ad, not shelf price / Demo catalog. */
  label: string;
  detail: string;
  error?: string;
  fetchedAt?: string;
  locationId?: string;
  /** Item names whose live lookup failed. Not a store-wide outage. */
  unpricedItems?: string[];
  /**
   * Set when the store timed out, errored, or was rate-limited.
   * Those lines were not checked. They are not missing from the shelf.
   */
  check?: "timeout" | "error" | "rate_limit";
  uncheckedItems?: string[];
};

export type StorePricingAccumulator = {
  storeName: string;
  configured: boolean;
  attempted: boolean;
  liveHits: number;
  cachedHits: number;
  weeklyAdHits: number;
  cachedWeeklyAdHits: number;
  seedHits: number;
  errors: string[];
  /** Per-item provider failures. Kept off the shopper toast. */
  unpricedItems: string[];
  /** Lines skipped because the store timed out, errored, or the budget ran out. */
  uncheckedItems: string[];
  check?: "timeout" | "error" | "rate_limit";
  locationId?: string;
  fetchedAt?: Date;
  feedKind?: PricingFeedKind;
};
