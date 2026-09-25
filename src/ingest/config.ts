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
};

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
    maxProducts: intEnv("CATALOG_MAX_PRODUCTS", 40_000, 1, 500_000),
    maxOffers: intEnv("CATALOG_MAX_OFFERS", 160_000, 1, 2_000_000),
    refreshHours: intEnv("CATALOG_REFRESH_HOURS", 24, 1, 24 * 30),
    walmartEnabled: boolEnv("WALMART_INGEST_ENABLED", true),
    krogerEnabled: boolEnv("KROGER_INGEST_ENABLED", true),
    walmartDailyBudget: intEnv("WALMART_INGEST_DAILY_BUDGET", 1500, 1, 100_000),
    // 5s: production 429'd on a ~2s burst well under the daily cap (2026-09-25).
    walmartMinIntervalMs: intEnv("WALMART_INGEST_MIN_INTERVAL_MS", 5000, 0, 120_000),
    krogerDailyBudget: intEnv("KROGER_INGEST_DAILY_BUDGET", 4000, 1, 100_000),
    krogerMinIntervalMs: intEnv("KROGER_INGEST_MIN_INTERVAL_MS", 500, 0, 120_000),
    krogerPageLimit: intEnv("KROGER_PAGE_LIMIT", 50, 1, 200),
    krogerMaxPagesPerTerm: intEnv("KROGER_MAX_PAGES_PER_TERM", 8, 1, 40),
    locationDailyBudget: intEnv("KROGER_LOCATION_DAILY_BUDGET", 200, 1, 1600),
    seedZips: parseZipList(process.env.CATALOG_SEED_ZIPS, DEFAULT_SEED_ZIPS),
    shopperZipLimit: intEnv("CATALOG_SHOPPER_ZIP_LIMIT", 12, 1, 100),
    browseScan: intEnv("CATALOG_BROWSE_SCAN", 1500, 50, 5000),
  };
}

/** Rough BSON size used by the admin status payload and the README estimate. */
export function estimateStorageBytes(products: number, offers: number): number {
  return products * 1200 + offers * 400;
}
