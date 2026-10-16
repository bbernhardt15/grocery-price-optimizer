import { timingSafeEqual } from "node:crypto";
import type { PipelineStage } from "mongoose";
import { DEPARTMENTS, departmentById, mapToDepartment } from "../catalog/departments";
import { krogerProductIdForLookup, walmartUpcForLookup } from "../catalog/normalize";
import { estimateStorageBytes, ingestConfig, lookupCallsForTick } from "./config";
import { utcDay, type IngestErrorDetail } from "./budget";
import { matchProgress, nextKrogerLookups, nextWalmartLookups, type LookupPick } from "./crossLookup";
import { IngestBudget, IngestCheckpoint, CatalogMaster, CatalogOffer, ShopperZip } from "./models";

export function presentIngestError(entry: unknown): IngestErrorDetail | { message: string } {
  if (typeof entry === "string") {
    return { message: entry };
  }
  if (entry && typeof entry === "object") {
    const record = entry as Partial<IngestErrorDetail> & { params?: unknown };
    const params =
      record.params && typeof record.params === "object"
        ? (record.params as IngestErrorDetail["params"])
        : {};
    return {
      provider: typeof record.provider === "string" ? record.provider : "unknown",
      status: typeof record.status === "number" ? record.status : null,
      message: typeof record.message === "string" ? record.message : "Ingest error",
      params,
      ...(typeof record.body === "string" && record.body ? { body: record.body } : {}),
      ...(record.headers && typeof record.headers === "object" ? { headers: stringHeaders(record.headers) } : {}),
      at: typeof record.at === "string" ? record.at : "",
    };
  }
  return { message: String(entry) };
}

function stringHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" && entry.trim()) {
      out[key] = entry;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

type MasterCensus = {
  localWalmart: number;
  localOther: number;
  krogerOnly: number;
  walmartUpc: number;
  merged: number;
  otherUpc: number;
};

const EMPTY_CENSUS: MasterCensus = {
  localWalmart: 0,
  localOther: 0,
  krogerOnly: 0,
  walmartUpc: 0,
  merged: 0,
  otherUpc: 0,
};

/** How the product cap is filled: shadow keys vs Kroger-only vs Walmart UPC vs merged. */
async function masterKeyCensus(): Promise<MasterCensus> {
  const local = { $regexMatch: { input: "$key", regex: "^local:" } };
  const localWalmart = { $regexMatch: { input: "$key", regex: "^local:walmart:" } };
  const notLocal = { $not: [local] };
  const hasWalmart = { $gt: [{ $strLenCP: { $ifNull: ["$walmartItemId", ""] } }, 0] };
  const hasKroger = { $gt: [{ $strLenCP: { $ifNull: ["$krogerProductId", ""] } }, 0] };
  const noWalmart = { $eq: [{ $strLenCP: { $ifNull: ["$walmartItemId", ""] } }, 0] };
  const noKroger = { $eq: [{ $strLenCP: { $ifNull: ["$krogerProductId", ""] } }, 0] };
  const count = (match: object) => ({ $sum: { $cond: [match, 1, 0] } });
  const [row] = await CatalogMaster.aggregate<MasterCensus & { _id: null }>([
    {
      $group: {
        _id: null,
        localWalmart: count(localWalmart),
        localOther: count({ $and: [local, { $not: [localWalmart] }] }),
        merged: count({ $and: [notLocal, hasWalmart, hasKroger] }),
        krogerOnly: count({ $and: [notLocal, hasKroger, noWalmart] }),
        walmartUpc: count({ $and: [notLocal, hasWalmart, noKroger] }),
        otherUpc: count({ $and: [notLocal, noWalmart, noKroger] }),
      },
    },
  ] as PipelineStage[]);
  if (!row) {
    return EMPTY_CENSUS;
  }
  return {
    localWalmart: row.localWalmart ?? 0,
    localOther: row.localOther ?? 0,
    krogerOnly: row.krogerOnly ?? 0,
    walmartUpc: row.walmartUpc ?? 0,
    merged: row.merged ?? 0,
    otherUpc: row.otherUpc ?? 0,
  };
}

function seedLocationsFrom(checkpoint: unknown, seedZips: string[]): Array<{ zip: string; locationId: string }> {
  if (!checkpoint || typeof checkpoint !== "object") {
    return [];
  }
  const locations = (checkpoint as { locations?: unknown }).locations;
  if (!Array.isArray(locations)) {
    return [];
  }
  const rows: Array<{ zip: string; locationId: string }> = [];
  for (const entry of locations) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const zip = String((entry as { zip?: unknown }).zip ?? "");
    const locationId = String((entry as { locationId?: unknown }).locationId ?? "");
    if (seedZips.includes(zip) && locationId) {
      rows.push({ zip, locationId });
    }
  }
  return rows;
}

export function adminTokenConfigured(): boolean {
  return Boolean(process.env.ADMIN_TOKEN?.trim());
}

export function adminAuthorized(header: string | undefined): boolean {
  const expected = process.env.ADMIN_TOKEN?.trim() ?? "";
  if (!expected || !header) {
    return false;
  }
  const presented = header.replace(/^Bearer\s+/i, "").trim();
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export async function catalogStatus() {
  const config = ingestConfig();
  const now = new Date();
  const day = utcDay(now);
  const [products, offers, stale, discontinued, byStore, byDepartment, checkpoints, budgets, zips, masters, walmartLookups, krogerLookups, progress] = await Promise.all([
    CatalogMaster.countDocuments(),
    CatalogOffer.countDocuments(),
    CatalogOffer.countDocuments({ status: "stale" }),
    CatalogOffer.countDocuments({ status: "discontinued" }),
    CatalogOffer.aggregate<{ _id: string; count: number }>([
      { $match: { status: { $ne: "discontinued" } } },
      { $group: { _id: "$storeName", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    CatalogMaster.aggregate<{ _id: string; count: number }>([
      { $match: { status: { $ne: "discontinued" } } },
      { $group: { _id: "$departmentId", count: { $sum: 1 } } },
    ]),
    IngestCheckpoint.find().lean(),
    IngestBudget.find({ day }).lean<Array<{ provider: string; calls: number }>>(),
    ShopperZip.find({ hits: { $gt: 0 } }).sort({ lastSeenAt: -1 }).limit(config.shopperZipLimit).lean(),
    masterKeyCensus(),
    CatalogMaster.countDocuments({ matchWalmartAt: { $type: "date" } }),
    CatalogMaster.countDocuments({ matchKrogerAt: { $type: "date" } }),
    matchProgress(now),
  ]);
  const departmentCounts = Object.fromEntries(DEPARTMENTS.map((department) => [department.id, 0]));
  for (const row of byDepartment) {
    departmentCounts[row._id] = row.count;
  }
  const used = Object.fromEntries(budgets.map((row) => [row.provider, row.calls]));
  const bytes = estimateStorageBytes(products, offers);
  const krogerRun = checkpoints.find((row) => row.provider === "kroger");
  return {
    enabled: config.enabled,
    dbFirst: config.dbFirst,
    day,
    counts: {
      products,
      offers,
      staleOffers: stale,
      discontinuedOffers: discontinued,
      byStore: Object.fromEntries(byStore.map((row) => [row._id, row.count])),
      byDepartment: departmentCounts,
      masters,
    },
    match: {
      merged: masters.merged,
      walmartLookups,
      krogerLookups,
      queue: progress.queue,
      hitRate: progress.hitRate,
      mergedToday: progress.mergedToday,
      lookupShare: progress.lookupShare,
      retryDays: progress.retryDays,
      walmartBatch: progress.walmartBatch,
      note: "Lookups take a share of each Walmart and Kroger tick, inside the existing daily budgets and the Walmart 429 pause. A miss is tried again after the cooldown. Nothing is deleted.",
    },
    caps: {
      maxProducts: config.maxProducts,
      maxOffers: config.maxOffers,
      productsRemaining: Math.max(0, config.maxProducts - products),
      offersRemaining: Math.max(0, config.maxOffers - offers),
    },
    storage: {
      estimatedBytes: bytes,
      estimatedMegabytes: Math.round((bytes / 1_000_000) * 10) / 10,
      note: "Estimate is about 1.2 KB per product master and 0.4 KB per offer, before indexes. Indexes are often about the same size again.",
    },
    budget: {
      walmart: {
        used: used.walmart ?? 0,
        limit: config.walmartDailyBudget,
        remaining: Math.max(0, config.walmartDailyBudget - (used.walmart ?? 0)),
        minIntervalMs: config.walmartMinIntervalMs,
      },
      kroger: {
        used: used.kroger ?? 0,
        limit: config.krogerDailyBudget,
        remaining: Math.max(0, config.krogerDailyBudget - (used.kroger ?? 0)),
        minIntervalMs: config.krogerMinIntervalMs,
      },
      krogerLocations: {
        used: used["kroger-locations"] ?? 0,
        limit: config.locationDailyBudget,
        remaining: Math.max(0, config.locationDailyBudget - (used["kroger-locations"] ?? 0)),
        minIntervalMs: config.krogerMinIntervalMs,
      },
    },
    runs: checkpoints.map((row) => {
      const checkpoint = row.checkpoint as { cooldownUntil?: unknown } | undefined;
      const cooldownUntil = typeof checkpoint?.cooldownUntil === "string" ? checkpoint.cooldownUntil : null;
      return {
        provider: row.provider,
        status: row.status,
        calls: row.calls,
        upserted: row.upserted,
        cycles: row.cycles,
        lastStartedAt: row.lastStartedAt,
        lastFinishedAt: row.lastFinishedAt,
        lastError: row.lastError,
        cooldownUntil,
        errors: (row.recentErrors ?? []).map((entry) => presentIngestError(entry)),
        checkpoint: row.checkpoint,
      };
    }),
    shopperZips: zips.map((row) => ({
      zip: row.zip,
      hits: row.hits,
      lastSeenAt: row.lastSeenAt,
      locationId: row.locationId,
    })),
    seedZips: config.seedZips,
    seedLocations: seedLocationsFrom(krogerRun?.checkpoint, config.seedZips),
  };
}

function storesOf(row: { walmartItemId?: string; krogerProductId?: string }): string {
  const stores = [
    row.krogerProductId?.trim() ? "kroger" : "",
    row.walmartItemId?.trim() ? "walmart" : "",
  ].filter(Boolean);
  return stores.join("+") || "none";
}

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Random masters in one department, with the rule the current mapper would use.
 * Compact so a PowerShell paste stays small.
 */
export async function catalogSample(department: string, rawLimit: number): Promise<
  | { error: string }
  | {
      department: string;
      n: number;
      items: Array<{ name: string; brand: string; stores: string; paths: string; stored: string; now: string; rule: string }>;
    }
> {
  const known = departmentById(department);
  if (!known) {
    return { error: `Unknown department "${department}".` };
  }
  const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 20));
  const rows = await CatalogMaster.aggregate<
    { name?: string; brand?: string; walmartItemId?: string; krogerProductId?: string; categoryPaths?: string[]; departmentId?: string }
  >([
    { $match: { departmentId: known.id, status: { $ne: "discontinued" } } },
    { $sample: { size: limit } },
    { $project: { name: 1, brand: 1, walmartItemId: 1, krogerProductId: 1, categoryPaths: 1, departmentId: 1 } },
  ]);
  const items = rows.map((row) => {
    const paths = row.categoryPaths ?? [];
    const mapped = mapToDepartment(paths, row.name ?? "");
    return {
      name: clip(row.name ?? "", 80),
      brand: clip(row.brand ?? "", 40),
      stores: storesOf(row),
      paths: clip(paths.join(" | "), 120),
      stored: row.departmentId ?? "",
      now: mapped.departmentId,
      rule: mapped.reason ?? "none",
    };
  });
  return { department: known.id, n: items.length, items };
}

type KeyRow = { name?: string; upc?: string; key?: string; walmartItemId?: string; krogerProductId?: string };

function keySample(row: KeyRow): { name: string; key: string; upc: string; krogerId: string; walmartUpc: string; stores: string } {
  const source = row.upc || row.key || "";
  return {
    name: clip(row.name ?? "", 60),
    key: row.key ?? "",
    upc: row.upc ?? "",
    krogerId: krogerProductIdForLookup(source) ?? "",
    walmartUpc: walmartUpcForLookup(source) ?? "",
    stores: storesOf(row),
  };
}

async function sampleMasters(match: Record<string, unknown>, limit: number): Promise<KeyRow[]> {
  return CatalogMaster.aggregate<KeyRow>([
    { $match: match },
    { $sample: { size: limit } },
    { $project: { name: 1, upc: 1, key: 1, walmartItemId: 1, krogerProductId: 1 } },
  ]);
}

function presentPick(pick: LookupPick) {
  return {
    key: pick.key,
    name: pick.name,
    code: pick.code,
    variants: pick.codes,
    variantIndex: pick.variantIndex,
    priority: pick.priority,
  };
}

/**
 * The next lookup batch, without calling Walmart or Kroger and without
 * marking any master tried.
 */
export async function catalogMatchQueue(now = new Date()) {
  const config = ingestConfig();
  const calls = lookupCallsForTick(config.batchCalls, config.matchLookupShare);
  const progress = await matchProgress(now);
  const [walmart, kroger] = await Promise.all([
    nextWalmartLookups(now, calls * config.walmartLookupBatch, { dryRun: true }),
    nextKrogerLookups(now, calls, { dryRun: true }),
  ]);
  return {
    dryRun: true as const,
    callsPerTick: calls,
    ...progress,
    note: "Dry run. No retailer call is made and no master is marked.",
    walmart: walmart.map(presentPick),
    kroger: kroger.map(presentPick),
  };
}

/** A few normalized keys from each side, so production can confirm they line up. */
export async function catalogMatchSample(): Promise<{
  merged: number;
  walmartLookups: number;
  krogerLookups: number;
  note: string;
  krogerOnly: ReturnType<typeof keySample>[];
  walmartUpc: ReturnType<typeof keySample>[];
  both: ReturnType<typeof keySample>[];
}> {
  const notLocal = { key: { $not: { $regex: "^local:" } } };
  const has = (field: string) => ({ [field]: { $type: "string", $gt: "" } });
  const missing = (field: string) => ({ $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: "" }] });
  const [krogerOnly, walmartUpc, both, merged, walmartLookups, krogerLookups] = await Promise.all([
    sampleMasters({ ...notLocal, ...has("krogerProductId"), ...missing("walmartItemId") }, 3),
    sampleMasters({ ...notLocal, ...has("walmartItemId"), ...missing("krogerProductId") }, 3),
    sampleMasters({ ...notLocal, ...has("walmartItemId"), ...has("krogerProductId") }, 3),
    CatalogMaster.countDocuments({ ...notLocal, ...has("walmartItemId"), ...has("krogerProductId") }),
    CatalogMaster.countDocuments({ matchWalmartAt: { $type: "date" } }),
    CatalogMaster.countDocuments({ matchKrogerAt: { $type: "date" } }),
  ]);
  return {
    merged,
    walmartLookups,
    krogerLookups,
    note: "krogerId is the 13-digit Kroger form. walmartUpc is 12-digit UPC-A with the check digit. The same product should share key.",
    krogerOnly: krogerOnly.map(keySample),
    walmartUpc: walmartUpc.map(keySample),
    both: both.map(keySample),
  };
}
