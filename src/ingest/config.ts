/**
 * Catalog ingestion settings. The master switch is off until Brandon turns
 * it on, so a deploy does not start calling Walmart or Kroger by itself.
 */

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function floatEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return raw === "1" || raw === "true" || raw === "yes";
}

const DEFAULT_SEED_ZIPS = ["45103", "10001", "60601", "75201", "90012", "30303"];

export function parseZipList(raw: string | undefined, fallback: string[]): string[] {
  const source = raw === undefined ? fallback.join(",") : raw;
  const zips: string[] = [];
  for (const part of source.split(/[\s,]+/)) {
    const zip = part.trim().slice(0, 5);
    if (/^\d{5}$/.test(zip) && !zips.includes(zip)) {
      zips.push(zip);
    }
  }
  return zips;
}

export type IngestConfig = {
  /** Background crawl. Also turns on database-first reads. */
  enabled: boolean;
  /** Read browse/search/optimizer from Mongo even when the crawler is off. */
  dbFirst: boolean;
  intervalSeconds: number;
  batchCalls: number;
  staleDays: number;
  discontinueDays: number;
  maxProducts: number;
  maxOffers: number;
  refreshHours: number;
  walmartEnabled: boolean;
  krogerEnabled: boolean;
  walmartDailyBudget: number;
  walmartMinIntervalMs: number;
  krogerDailyBudget: number;
  krogerMinIntervalMs: number;
  krogerPageLimit: number;
  krogerMaxPagesPerTerm: number;
  locationDailyBudget: number;
  seedZips: string[];
  shopperZipLimit: number;
  browseScan: number;
  /** Fraction of each Walmart or Kroger tick spent on cross-store lookups. */
  matchLookupShare: number;
  /**
   * Legacy refresh fraction. Walmart uses this unless CATALOG_REFRESH_SHARE_WALMART is set.
   * Kroger has its own default.
   */
  refreshShare: number;
  /** Fraction of a Walmart tick spent refreshing stale offers. */
  refreshShareWalmart: number;
  /** Fraction of a Kroger tick spent refreshing stale offers. */
  refreshShareKroger: number;
  /** Days before a no-hit lookup is tried again. */
  matchRetryDays: number;
  /** UPCs per Walmart GET /items call. The Affiliate ids list allows 20. */
  walmartLookupBatch: number;
};

/** How many calls in one tick a share gets. At least one when the share is above zero. */
export function lookupCallsForTick(maxCalls: number, share: number): number {
  if (!(share > 0) || maxCalls < 1) {
    return 0;
  }
  return Math.min(maxCalls, Math.max(1, Math.round(maxCalls * share)));
}

/**
 * Split one tick across cross-store lookup, stale-offer refresh, and discovery.
 * Lookup is reserved first unless `refreshFirst` is set. The other share takes
 * what remains. Discovery is the rest, and it also receives calls when a queue is empty.
 */
export function tickCallSplit(
  maxCalls: number,
  lookupShare: number,
  refreshShare: number,
  refreshFirst = false
): { lookup: number; refresh: number; discovery: number } {
  const lookupBudget = lookupCallsForTick(maxCalls, lookupShare);
  const refreshBudget = lookupCallsForTick(maxCalls, refreshShare);
  const refresh = refreshFirst ? refreshBudget : Math.min(refreshBudget, Math.max(0, maxCalls - lookupBudget));
  const lookup = refreshFirst ? Math.min(lookupBudget, Math.max(0, maxCalls - refresh)) : lookupBudget;
  const discovery = Math.max(0, maxCalls - lookup - refresh);
  return { lookup, refresh, discovery };
}

/** Stale offers above this share of the live shelf take priority over match lookup. */
export const STALE_RATIO_REFRESH = 0.3;
/** Below this share, refresh gives budget back to crawling and matching. */
export const STALE_RATIO_DISCOVER = 0.15;
/**
 * Walmart Affiliate calls the crawler may make in one UTC day.
 * The configured budget stays at or under this. It is never raised.
 */
export const WALMART_AFFILIATE_DAILY_CAP = 1500;

export type BudgetMode = "refresh" | "balanced" | "discover";

export type EffectiveShares = {
  mode: BudgetMode;
  staleRatio: number;
  lookupShare: number;
  refreshShare: number;
  configuredLookupShare: number;
  configuredRefreshShare: number;
  /** When true, refresh is reserved before match lookup. */
  refreshFirst: boolean;
};

function clampShare(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function roundShare(value: number): number {
  return Math.round(clampShare(value) * 1000) / 1000;
}

export function staleRatioOf(stale: number, shelf: number): number {
  if (!(shelf > 0) || !(stale > 0)) {
    return 0;
  }
  return roundShare(stale / shelf);
}

/** Which way the shelf is leaning, before per-store pins. */
export function staleBudgetMode(staleRatio: number): BudgetMode {
  const ratio = clampShare(staleRatio);
  if (ratio > STALE_RATIO_REFRESH) {
    return "refresh";
  }
  if (ratio < STALE_RATIO_DISCOVER) {
    return "discover";
  }
  return "balanced";
}

export function refreshShareFor(config: IngestConfig, store: "walmart" | "kroger"): number {
  return store === "kroger" ? config.refreshShareKroger : config.refreshShareWalmart;
}

/**
 * Turn configured shares into the shares one tick should use.
 * Above 30% stale, match lookup is cut to at most 0.2 and the freed share is
 * added to refresh (capped at 0.8), and refresh is reserved first.
 * Below 15% stale, refresh is half of its configured share so crawling and
 * matching get the calls back.
 * A refresh share of 0 stays off. A lookup share of 1 keeps the whole tick.
 */
export function effectiveShares(input: {
  staleRatio: number;
  lookupShare: number;
  refreshShare: number;
}): EffectiveShares {
  const configuredLookupShare = clampShare(input.lookupShare);
  const configuredRefreshShare = clampShare(input.refreshShare);
  const staleRatio = clampShare(input.staleRatio);
  const base = { staleRatio: roundShare(staleRatio), configuredLookupShare, configuredRefreshShare };

  if (configuredRefreshShare <= 0 || configuredLookupShare >= 1) {
    return {
      ...base,
      mode: "balanced",
      lookupShare: configuredLookupShare,
      refreshShare: configuredLookupShare >= 1 ? 0 : configuredRefreshShare,
      refreshFirst: false,
    };
  }

  if (staleRatio > STALE_RATIO_REFRESH) {
    const lookupShare = Math.min(configuredLookupShare, 0.2);
    const freed = Math.max(0, configuredLookupShare - lookupShare);
    const refreshShare = Math.min(0.8, configuredRefreshShare + freed);
    return {
      ...base,
      mode: "refresh",
      lookupShare: roundShare(Math.min(lookupShare, Math.max(0, 1 - refreshShare))),
      refreshShare: roundShare(refreshShare),
      refreshFirst: true,
    };
  }

  if (staleRatio < STALE_RATIO_DISCOVER) {
    const refreshShare = configuredRefreshShare * 0.5;
    return {
      ...base,
      mode: "discover",
      lookupShare: roundShare(Math.min(configuredLookupShare, Math.max(0, 1 - refreshShare))),
      refreshShare: roundShare(refreshShare),
      refreshFirst: false,
    };
  }

  return {
    ...base,
    mode: "balanced",
    lookupShare: roundShare(configuredLookupShare),
    refreshShare: roundShare(configuredRefreshShare),
    refreshFirst: false,
  };
}

export function ingestConfig(): IngestConfig {
  const enabled = boolEnv("CATALOG_INGEST_ENABLED");
  const dbFirst = boolEnv("CATALOG_DB_FIRST") || enabled;
  let staleDays = intEnv("CATALOG_STALE_DAYS", 14, 1, 365);
  let discontinueDays = intEnv("CATALOG_DISCONTINUE_DAYS", 45, 2, 3650);
  if (discontinueDays <= staleDays) {
    discontinueDays = staleDays + 1;
  }
  return {
    enabled,
    dbFirst,
    intervalSeconds: intEnv("CATALOG_INGEST_INTERVAL_SECONDS", 20, 5, 3600),
    batchCalls: intEnv("CATALOG_INGEST_BATCH_CALLS", 4, 1, 25),
    staleDays,
    discontinueDays,
    // 150k masters is about 180 MB of documents; 500k offers about 200 MB.
    // Indexes are often about the same size again, so plan on roughly 760 MB.
    maxProducts: intEnv("CATALOG_MAX_PRODUCTS", 150_000, 1, 500_000),
    maxOffers: intEnv("CATALOG_MAX_OFFERS", 500_000, 1, 2_000_000),
    refreshHours: intEnv("CATALOG_REFRESH_HOURS", 24, 1, 24 * 30),
    walmartEnabled: boolEnv("WALMART_INGEST_ENABLED", true),
    krogerEnabled: boolEnv("KROGER_INGEST_ENABLED", true),
    // 500/day: production 429'd at ~660 calls with a 5s gap (2026-09-29).
    // This caps the crawler only. Shopper searches are not charged and are not blocked.
    // The Affiliate day limit used here is 1,500. A higher env value is clamped
    // down to that. The default is not raised.
    walmartDailyBudget: intEnv("WALMART_INGEST_DAILY_BUDGET", 500, 1, WALMART_AFFILIATE_DAILY_CAP),
    walmartMinIntervalMs: intEnv("WALMART_INGEST_MIN_INTERVAL_MS", 10_000, 0, 120_000),
    krogerDailyBudget: intEnv("KROGER_INGEST_DAILY_BUDGET", 4000, 1, 100_000),
    krogerMinIntervalMs: intEnv("KROGER_INGEST_MIN_INTERVAL_MS", 500, 0, 120_000),
    krogerPageLimit: intEnv("KROGER_PAGE_LIMIT", 50, 1, 200),
    krogerMaxPagesPerTerm: intEnv("KROGER_MAX_PAGES_PER_TERM", 8, 1, 40),
    locationDailyBudget: intEnv("KROGER_LOCATION_DAILY_BUDGET", 200, 1, 1600),
    seedZips: parseZipList(process.env.CATALOG_SEED_ZIPS, DEFAULT_SEED_ZIPS),
    shopperZipLimit: intEnv("CATALOG_SHOPPER_ZIP_LIMIT", 12, 1, 100),
    browseScan: intEnv("CATALOG_BROWSE_SCAN", 1500, 50, 5000),
    matchLookupShare: floatEnv("CATALOG_MATCH_LOOKUP_SHARE", 0.5, 0, 1),
    refreshShare: floatEnv("CATALOG_REFRESH_SHARE", 0.3, 0, 1),
    refreshShareWalmart: floatEnv(
      "CATALOG_REFRESH_SHARE_WALMART",
      floatEnv("CATALOG_REFRESH_SHARE", 0.3, 0, 1),
      0,
      1
    ),
    refreshShareKroger: floatEnv("CATALOG_REFRESH_SHARE_KROGER", 0.6, 0, 1),
    matchRetryDays: intEnv("CATALOG_MATCH_RETRY_DAYS", 14, 1, 365),
    walmartLookupBatch: intEnv("WALMART_LOOKUP_BATCH", 20, 1, 20),
  };
}

/** Rough BSON size used by the admin status payload and the README estimate. */
export function estimateStorageBytes(products: number, offers: number): number {
  return products * 1200 + offers * 400;
}
