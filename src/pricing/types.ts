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
};

export class StorePricingError extends Error {
  readonly storeName: string;
  readonly code: "missing_credentials" | "http" | "network" | "not_available";
  readonly status?: number;

  constructor(
    storeName: string,
    message: string,
    code: "missing_credentials" | "http" | "network" | "not_available" = "http",
    status?: number
  ) {
    super(message);
    this.name = "StorePricingError";
    this.storeName = storeName;
    this.code = code;
    this.status = status;
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
  /** Shopper-facing label: Live prices / Partner feed / Cached live / Weekly ad / Demo catalog. */
  label: string;
  detail: string;
  error?: string;
  fetchedAt?: string;
  locationId?: string;
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
  locationId?: string;
  fetchedAt?: Date;
  feedKind?: PricingFeedKind;
};
