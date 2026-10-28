/**
 * Catalog ingestion settings. The master switch is off until Brandon turns
 * it on, so a deploy does not start calling Walmart or Kroger by itself.
 */

import { WALMART_LOOKUP_IDS_MAX } from "./walmartRefreshBatch";

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
  /** Ids per Walmart GET /items call. Affiliate `ids` and `upc` lists allow 20. */
  walmartLookupBatch: number;
  /** Crawl share kept even when stale offers are above 30%. */
  staleDiscoveryShare: number;
  /** Match share kept even when stale offers are above 30%. */
  staleLookupShare: number;
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
 * When `discoveryShare` is above zero, that crawl floor is reserved inside the
 * tick and refresh cannot spend it while its own queue is full.
 */
export function tickCallSplit(
  maxCalls: number,
  lookupShare: number,
  refreshShare: number,
  refreshFirst = false,
  discoveryShare = 0
): { lookup: number; refresh: number; discovery: number } {
  if (discoveryShare > 0) {
    return allocateTickCalls(
      maxCalls,
      { lookup: lookupShare, refresh: refreshShare, discovery: discoveryShare },
      refreshFirst ? ["refresh", "lookup", "discovery"] : ["lookup", "refresh", "discovery"]
    );
  }
  const lookupBudget = lookupCallsForTick(maxCalls, lookupShare);
  const refreshBudget = lookupCallsForTick(maxCalls, refreshShare);
  const refresh = refreshFirst ? refreshBudget : Math.min(refreshBudget, Math.max(0, maxCalls - lookupBudget));
  const lookup = refreshFirst ? Math.min(lookupBudget, Math.max(0, maxCalls - refresh)) : lookupBudget;
  const discovery = Math.max(0, maxCalls - lookup - refresh);
  return { lookup, refresh, discovery };
}

/**
 * Turn fractional shares into whole calls. Each positive share gets one call
 * when the tick is large enough, then leftover calls follow the largest
 * remainder. A tick smaller than the number of shares follows `priority`.
 */
export function allocateTickCalls(
  maxCalls: number,
  weights: { lookup: number; refresh: number; discovery: number },
  priority: Array<"lookup" | "refresh" | "discovery">
): { lookup: number; refresh: number; discovery: number } {
  const result = { lookup: 0, refresh: 0, discovery: 0 };
  const calls = Math.max(0, Math.floor(maxCalls));
  if (calls === 0) {
    return result;
  }
  const active = priority.filter((key) => weights[key] > 0);
  const total = active.reduce((sum, key) => sum + weights[key], 0);
  if (active.length === 0 || !(total > 0)) {
    return result;
  }
  if (calls < active.length) {
    for (const key of priority) {
      if (weights[key] > 0 && result.lookup + result.refresh + result.discovery < calls) {
        result[key] = 1;
      }
    }
    return result;
  }
  const rows = active.map((key) => {
    const exact = (weights[key] / total) * calls;
    return { key, base: Math.floor(exact), frac: exact - Math.floor(exact) };
  });
  let used = rows.reduce((sum, row) => sum + row.base, 0);
  const byNeed = [...rows].sort((a, b) => {
    if (a.base === 0 && b.base !== 0) {
      return -1;
    }
    if (b.base === 0 && a.base !== 0) {
      return 1;
    }
    if (b.frac !== a.frac) {
      return b.frac - a.frac;
    }
    return priority.indexOf(a.key) - priority.indexOf(b.key);
  });
  for (const row of byNeed) {
    if (used >= calls) {
      break;
    }
    if (row.base === 0) {
      row.base = 1;
      used += 1;
    }
  }
  for (const row of byNeed) {
    if (used >= calls) {
      break;
    }
    row.base += 1;
    used += 1;
  }
  while (used > calls) {
    const donor = [...rows].sort((a, b) => b.base - a.base)[0];
    if (!donor || donor.base <= 0) {
      break;
    }
    donor.base -= 1;
    used -= 1;
  }
  for (const row of rows) {
    result[row.key] = row.base;
  }
  return result;
}

/**
 * Which part of the tick runs next.
 * While the shelf is stale, refresh runs before lookup. The crawl floor runs
 * before leftover calls go back to refresh, so a full refresh queue cannot
 * stall both walks. Below the stale line, lookup is reserved first and any
 * call neither queue takes goes to discovery.
 */
export function nextTickTurn(input: {
  refreshFirst: boolean;
  /** Lookup client exists and the queue has not come back empty. */
  lookupPending: boolean;
  /** Refresh client exists and the queue has not come back empty. */
  refreshPending: boolean;
  lookupsDone: number;
  lookupBudget: number;
  refreshesDone: number;
  refreshBudget: number;
  /** Crawl calls already started this tick. */
  discoveryDone?: number;
  /** Crawl calls reserved this tick. Zero keeps the old "leftover" behavior. */
  discoveryBudget?: number;
}): "lookup" | "refresh" | "discover" {
  const lookupRoom = input.lookupPending && input.lookupsDone < input.lookupBudget;
  const refreshRoom = input.refreshPending && input.refreshesDone < input.refreshBudget;
  const discoveryBudget = input.discoveryBudget ?? 0;
  const discoveryRoom = discoveryBudget > 0 && (input.discoveryDone ?? 0) < discoveryBudget;
  if (input.refreshFirst) {
    if (refreshRoom) {
      return "refresh";
    }
    if (lookupRoom) {
      return "lookup";
    }
    if (discoveryRoom) {
      return "discover";
    }
    if (input.refreshBudget > 0 && input.refreshPending) {
      return "refresh";
    }
    return "discover";
  }
  if (lookupRoom) {
    return "lookup";
  }
  if (refreshRoom) {
    return "refresh";
  }
  if (discoveryRoom) {
    return "discover";
  }
  return "discover";
}

/** Stale offers above this share of the live shelf take priority over match lookup. */
export const STALE_RATIO_REFRESH = 0.3;
/** Below this share, refresh gives budget back to crawling and matching. */
export const STALE_RATIO_DISCOVER = 0.15;
/**
 * Crawl floor while the shelf is above {@link STALE_RATIO_REFRESH}.
 * Refresh used to take the rest of the tick, which stalled both walks.
 */
export const DEFAULT_STALE_DISCOVERY_SHARE = 0.15;
/** Match floor while the shelf is above {@link STALE_RATIO_REFRESH}. Capped by the configured lookup share. */
export const DEFAULT_STALE_LOOKUP_SHARE = 0.15;
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
  /** Calls that stay on crawling. Zero in balanced mode means "whatever the split has left". */
  discoveryShare: number;
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
 * Above 30% stale, refresh still goes first, but crawl keeps
 * `staleDiscoveryShare` (default 0.15) and match keeps up to
 * `staleLookupShare` (default 0.15, and never more than the configured lookup
 * share). Refresh gets the rest, which is 0.70 at the defaults. A floor of 0
 * gives that share back to refresh.
 * Below 15% stale, refresh is half of its configured share so crawling and
 * matching get the calls back.
 * A refresh share of 0 stays off. A lookup share of 1 keeps the whole tick.
 */
export function effectiveShares(input: {
  staleRatio: number;
  lookupShare: number;
  refreshShare: number;
  staleDiscoveryShare?: number;
  staleLookupShare?: number;
}): EffectiveShares {
  const configuredLookupShare = clampShare(input.lookupShare);
  const configuredRefreshShare = clampShare(input.refreshShare);
  const staleRatio = clampShare(input.staleRatio);
  const base = { staleRatio: roundShare(staleRatio), configuredLookupShare, configuredRefreshShare };

  if (configuredRefreshShare <= 0 || configuredLookupShare >= 1) {
    const refreshShare = configuredLookupShare >= 1 ? 0 : configuredRefreshShare;
    return {
      ...base,
      mode: "balanced",
      lookupShare: configuredLookupShare,
      refreshShare,
      discoveryShare: roundShare(Math.max(0, 1 - configuredLookupShare - refreshShare)),
      refreshFirst: false,
    };
  }

  if (staleRatio > STALE_RATIO_REFRESH) {
    let discoveryShare = clampShare(input.staleDiscoveryShare ?? DEFAULT_STALE_DISCOVERY_SHARE);
    let lookupShare = Math.min(configuredLookupShare, clampShare(input.staleLookupShare ?? DEFAULT_STALE_LOOKUP_SHARE));
    if (discoveryShare + lookupShare > 1) {
      const scale = 1 / (discoveryShare + lookupShare);
      discoveryShare *= scale;
      lookupShare *= scale;
    }
    const refreshShare = Math.max(0, 1 - discoveryShare - lookupShare);
    return {
      ...base,
      mode: "refresh",
      lookupShare: roundShare(lookupShare),
      refreshShare: roundShare(refreshShare),
      discoveryShare: roundShare(discoveryShare),
      refreshFirst: true,
    };
  }

  if (staleRatio < STALE_RATIO_DISCOVER) {
    const refreshShare = configuredRefreshShare * 0.5;
    const lookupShare = Math.min(configuredLookupShare, Math.max(0, 1 - refreshShare));
    return {
      ...base,
      mode: "discover",
      lookupShare: roundShare(lookupShare),
      refreshShare: roundShare(refreshShare),
      discoveryShare: roundShare(Math.max(0, 1 - lookupShare - refreshShare)),
      refreshFirst: false,
    };
  }

  return {
    ...base,
    mode: "balanced",
    lookupShare: roundShare(configuredLookupShare),
    refreshShare: roundShare(configuredRefreshShare),
    discoveryShare: roundShare(Math.max(0, 1 - configuredLookupShare - configuredRefreshShare)),
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
    // 500/day stays. Production 429'd near 660 calls with a 5s gap (2026-09-29)
    // and near 1,137 calls with a 2s gap (2026-09-25). Affiliate docs still do
    // not publish a daily quota (Marketplace tables are a different API), so
    // the default is not raised toward the 1,500 clamp. That clamp is a ceiling
    // on the env var, not Walmart's limit. Stretch the 500 with GET /items
    // batching (up to 20 ids per call) instead of more calls. The default
    // stays 500. A temporary raise belongs in WALMART_INGEST_DAILY_BUDGET
    // and must stay at or under 1,500.
    // This caps the crawler only. Shopper searches are not charged and are not blocked.
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
    walmartLookupBatch: intEnv("WALMART_LOOKUP_BATCH", WALMART_LOOKUP_IDS_MAX, 1, WALMART_LOOKUP_IDS_MAX),
    staleDiscoveryShare: floatEnv("CATALOG_STALE_DISCOVERY_SHARE", DEFAULT_STALE_DISCOVERY_SHARE, 0, 0.5),
    staleLookupShare: floatEnv("CATALOG_STALE_LOOKUP_SHARE", DEFAULT_STALE_LOOKUP_SHARE, 0, 0.5),
  };
}

/** Rough BSON size used by the admin status payload and the README estimate. */
export function estimateStorageBytes(products: number, offers: number): number {
  return products * 1200 + offers * 400;
}
