import { krogerLookupCodes, upcKey, walmartLookupCodes } from "../catalog/normalize";
import { Product } from "../models/Product";
import { utcDay } from "./budget";
import { ingestConfig } from "./config";
import { CATALOG_DEMAND_DAYS, demandText } from "./demand";
import { CatalogDemand, CatalogMaster, CatalogMatchDay, CatalogOffer } from "./models";

/**
 * Shopper demand first (saved lists, then recent searches), then staple
 * aisles, then the rest. A miss keeps the next GTIN variant eligible
 * immediately. After the last variant misses, the master waits out the
 * cooldown and is tried again. Nothing is deleted.
 */
const STAPLE_DEPARTMENTS = [
  "dairy-eggs",
  "produce",
  "meat-seafood",
  "bakery",
  "beverages",
  "breakfast",
  "pantry",
  "frozen",
  "snacks",
  "household",
  "deli",
  "baby",
  "personal-care",
  "pet",
  "other",
] as const;

const BATCH = 30;

type Side = "walmart" | "kroger";

export type LookupPriority = "list" | "search" | "staple" | "catalog";

export type LookupPick = {
  key: string;
  name: string;
  code: string;
  codes: string[];
  variantIndex: number;
  priority: LookupPriority;
  /** Stored retailer code, so a Kroger hit can stay on this master. */
  upc?: string;
};

type CandidateRow = {
  key: string;
  name: string;
  upc?: string;
  departmentId?: string;
  matchWalmartVariant?: number;
  matchKrogerVariant?: number;
};

type DemandSets = {
  listKeys: string[];
  searchKeys: string[];
  listNames: string[];
  searchNames: string[];
};

function stapleRank(departmentId: string | undefined): number {
  const index = STAPLE_DEPARTMENTS.indexOf(departmentId as (typeof STAPLE_DEPARTMENTS)[number]);
  return index === -1 ? STAPLE_DEPARTMENTS.length : index;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function retryMs(): number {
  return ingestConfig().matchRetryDays * 86_400_000;
}

function dueClauses(side: Side, now: Date): Record<string, unknown>[] {
  const tried = side === "walmart" ? "matchWalmartAt" : "matchKrogerAt";
  const variant = side === "walmart" ? "matchWalmartVariant" : "matchKrogerVariant";
  const has = side === "walmart" ? "krogerProductId" : "walmartItemId";
  const missing = side === "walmart" ? "walmartItemId" : "krogerProductId";
  const cutoff = new Date(now.getTime() - retryMs());
  return [
    { key: { $not: /^local:/ } },
    { [has]: { $type: "string", $ne: "" } },
    { $or: [{ [missing]: { $exists: false } }, { [missing]: null }, { [missing]: "" }] },
    {
      $or: [
        { [variant]: { $gt: 0 } },
        { [tried]: { $exists: false } },
        { [tried]: null },
        { [tried]: { $lte: cutoff } },
      ],
    },
  ];
}

async function loadDemand(now: Date): Promise<DemandSets> {
  const since = new Date(now.getTime() - CATALOG_DEMAND_DAYS * 86_400_000);
  const [rows, products] = await Promise.all([
    CatalogDemand.find({ lastSeenAt: { $gte: since } })
      .sort({ hits: -1, lastSeenAt: -1 })
      .limit(80)
      .select("kind text upcKey")
      .lean<Array<{ kind?: string; text?: string; upcKey?: string }>>(),
    Product.find({ updatedAt: { $gte: since }, upc: { $type: "string", $ne: "" } })
      .sort({ updatedAt: -1 })
      .limit(80)
      .select("upc name")
      .lean<Array<{ upc?: string; name?: string }>>(),
  ]);
  const listKeys: string[] = [];
  const searchKeys: string[] = [];
  const listNames: string[] = [];
  const searchNames: string[] = [];
  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  const addKey = (bucket: string[], key: string | undefined) => {
    const trimmed = key?.trim() ?? "";
    if (!trimmed || seenKeys.has(trimmed) || bucket.length >= 40) {
      return;
    }
    seenKeys.add(trimmed);
    bucket.push(trimmed);
  };
  const addName = (bucket: string[], text: string | undefined) => {
    const phrase = demandText(text);
    if (!phrase || seenNames.has(phrase) || bucket.length >= 8) {
      return;
    }
    seenNames.add(phrase);
    bucket.push(phrase);
  };
  for (const row of rows) {
    const keys = row.kind === "list" ? listKeys : searchKeys;
    const names = row.kind === "list" ? listNames : searchNames;
    addKey(keys, row.upcKey);
    if (!row.text?.startsWith("upc:")) {
      addName(names, row.text);
    }
  }
  for (const product of products) {
    addKey(searchKeys, upcKey(product.upc) ?? undefined);
    addName(searchNames, product.name);
  }
  return { listKeys, searchKeys, listNames, searchNames };
}

async function rankRows(rows: CandidateRow[]): Promise<CandidateRow[]> {
  if (rows.length === 0) {
    return rows;
  }
  const counts = await CatalogOffer.aggregate<{ _id: string; n: number }>([
    { $match: { productKey: { $in: rows.map((row) => row.key) } } },
    { $group: { _id: "$productKey", n: { $sum: 1 } } },
  ]);
  const byKey = new Map(counts.map((row) => [row._id, row.n]));
  return [...rows].sort((a, b) => {
    const staple = stapleRank(a.departmentId) - stapleRank(b.departmentId);
    if (staple !== 0) {
      return staple;
    }
    const offers = (byKey.get(b.key) ?? 0) - (byKey.get(a.key) ?? 0);
    if (offers !== 0) {
      return offers;
    }
    return a.name.localeCompare(b.name);
  });
}

function toPick(side: Side, row: CandidateRow, priority: LookupPriority): LookupPick | null {
  const codes = side === "walmart" ? walmartLookupCodes(row.upc || row.key) : krogerLookupCodes(row.upc || row.key);
  if (codes.length === 0) {
    return null;
  }
  const stored = side === "walmart" ? row.matchWalmartVariant ?? 0 : row.matchKrogerVariant ?? 0;
  const variantIndex = stored > 0 && stored < codes.length ? stored : 0;
  return {
    key: row.key,
    name: row.name,
    code: codes[variantIndex] ?? codes[0],
    codes,
    variantIndex,
    priority,
    ...(row.upc ? { upc: row.upc } : {}),
  };
}

async function fetchRows(side: Side, now: Date, extra: Record<string, unknown>, exclude: string[]): Promise<CandidateRow[]> {
  const clauses = [...dueClauses(side, now), extra];
  if (exclude.length > 0) {
    clauses.push({ key: { $nin: exclude } });
  }
  return CatalogMaster.find({ $and: clauses })
    .select("key name upc departmentId matchWalmartVariant matchKrogerVariant")
    .limit(BATCH)
    .lean<CandidateRow[]>();
}

async function nextLookups(side: Side, now: Date, limit: number, dryRun: boolean): Promise<LookupPick[]> {
  const want = Math.max(0, Math.min(200, Math.floor(limit)));
  if (want === 0) {
    return [];
  }
  const demand = await loadDemand(now);
  const passes: Array<{ priority: LookupPriority; extra: Record<string, unknown> }> = [];
  if (demand.listKeys.length > 0) {
    passes.push({ priority: "list", extra: { key: { $in: demand.listKeys } } });
  }
  if (demand.searchKeys.length > 0) {
    passes.push({ priority: "search", extra: { key: { $in: demand.searchKeys } } });
  }
  for (const phrase of demand.listNames.slice(0, 5)) {
    passes.push({ priority: "list", extra: { name: { $regex: escapeRegex(phrase), $options: "i" } } });
  }
  for (const phrase of demand.searchNames.slice(0, 5)) {
    passes.push({ priority: "search", extra: { name: { $regex: escapeRegex(phrase), $options: "i" } } });
  }
  for (const departmentId of STAPLE_DEPARTMENTS) {
    passes.push({
      priority: departmentId === "other" ? "catalog" : "staple",
      extra: { departmentId },
    });
  }
  const chosen: LookupPick[] = [];
  const seen = new Set<string>();
  const retire: string[] = [];
  for (const pass of passes) {
    if (chosen.length >= want) {
      break;
    }
    const include = pass.extra.key && typeof pass.extra.key === "object" && "$in" in pass.extra.key
      ? (pass.extra.key as { $in: string[] }).$in.filter((key) => !seen.has(key))
      : null;
    if (include && include.length === 0) {
      continue;
    }
    const extra = include ? { key: { $in: include } } : pass.extra;
    const rows = await rankRows(await fetchRows(side, now, extra, [...seen]));
    for (const row of rows) {
      if (chosen.length >= want) {
        break;
      }
      if (seen.has(row.key)) {
        continue;
      }
      seen.add(row.key);
      const pick = toPick(side, row, pass.priority);
      if (!pick) {
        retire.push(row.key);
        continue;
      }
      chosen.push(pick);
    }
  }
  if (!dryRun && retire.length > 0) {
    const at = side === "walmart" ? "matchWalmartAt" : "matchKrogerAt";
    const variant = side === "walmart" ? "matchWalmartVariant" : "matchKrogerVariant";
    await CatalogMaster.updateMany({ key: { $in: retire } }, { $set: { [at]: now, [variant]: 0 } });
  }
  return chosen;
}

export async function nextWalmartLookups(
  now: Date,
  limit: number,
  options?: { dryRun?: boolean }
): Promise<LookupPick[]> {
  return nextLookups("walmart", now, limit, options?.dryRun === true);
}

export async function nextKrogerLookups(
  now: Date,
  limit: number,
  options?: { dryRun?: boolean }
): Promise<LookupPick[]> {
  return nextLookups("kroger", now, limit, options?.dryRun === true);
}

/** @deprecated Use {@link nextWalmartLookups}. Returns the first queued code. */
export async function nextWalmartLookup(now: Date): Promise<{ key: string; name: string; upc: string } | null> {
  const [row] = await nextWalmartLookups(now, 1);
  return row ? { key: row.key, name: row.name, upc: row.code } : null;
}

/** @deprecated Use {@link nextKrogerLookups}. Returns the first queued product id. */
export async function nextKrogerLookup(now: Date): Promise<{ key: string; name: string; productId: string } | null> {
  const [row] = await nextKrogerLookups(now, 1);
  return row ? { key: row.key, name: row.name, productId: row.code } : null;
}

export async function markLookupResult(
  side: Side,
  pick: Pick<LookupPick, "key" | "variantIndex" | "codes">,
  hit: boolean,
  now: Date
): Promise<void> {
  const at = side === "walmart" ? "matchWalmartAt" : "matchKrogerAt";
  const variant = side === "walmart" ? "matchWalmartVariant" : "matchKrogerVariant";
  if (hit || pick.variantIndex + 1 >= Math.max(1, pick.codes.length)) {
    await CatalogMaster.updateOne({ key: pick.key }, { $set: { [at]: now, [variant]: 0 } });
    return;
  }
  await CatalogMaster.updateOne({ key: pick.key }, { $set: { [variant]: pick.variantIndex + 1 } });
}

export async function markWalmartLookup(key: string, now: Date): Promise<void> {
  await markLookupResult("walmart", { key, variantIndex: 0, codes: ["done"] }, false, now);
}

export async function markKrogerLookup(key: string, now: Date): Promise<void> {
  await markLookupResult("kroger", { key, variantIndex: 0, codes: ["done"] }, false, now);
}

async function matchedStoreKeys(side: Side, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) {
    return new Set();
  }
  const field = side === "walmart" ? "walmartItemId" : "krogerProductId";
  const rows = await CatalogMaster.find({
    key: { $in: keys },
    [field]: { $type: "string", $ne: "" },
  })
    .select("key")
    .lean<Array<{ key: string }>>();
  return new Set(rows.map((row) => row.key));
}

/** Mark each pick hit or miss and add the day's attempt counters. */
export async function finishLookups(
  side: Side,
  picks: LookupPick[],
  now: Date,
  options?: { forceMiss?: boolean }
): Promise<{ attempts: number; hits: number }> {
  if (picks.length === 0) {
    return { attempts: 0, hits: 0 };
  }
  const hitKeys = options?.forceMiss ? new Set<string>() : await matchedStoreKeys(side, picks.map((pick) => pick.key));
  let hits = 0;
  for (const pick of picks) {
    const hit = hitKeys.has(pick.key);
    if (hit) {
      hits += 1;
    }
    await markLookupResult(side, pick, hit, now);
  }
  const day = utcDay(now);
  const attemptsField = side === "walmart" ? "walmartAttempts" : "krogerAttempts";
  const hitsField = side === "walmart" ? "walmartHits" : "krogerHits";
  await CatalogMatchDay.updateOne(
    { day },
    { $inc: { [attemptsField]: picks.length, [hitsField]: hits }, $setOnInsert: { day } },
    { upsert: true }
  );
  return { attempts: picks.length, hits };
}

function rate(hits: number, attempts: number): number | null {
  if (attempts <= 0) {
    return null;
  }
  return Math.round((hits / attempts) * 1000) / 1000;
}

export async function countLookupQueue(side: Side, now = new Date()): Promise<number> {
  return CatalogMaster.countDocuments({ $and: dueClauses(side, now) });
}

export async function matchProgress(now = new Date()) {
  const config = ingestConfig();
  const day = utcDay(now);
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86_400_000);
  const [walmart, kroger, mergedToday, ledger] = await Promise.all([
    countLookupQueue("walmart", now),
    countLookupQueue("kroger", now),
    CatalogMaster.countDocuments({ mergedAt: { $gte: start, $lt: end } }),
    CatalogMatchDay.findOne({ day }).lean<{
      walmartAttempts?: number;
      walmartHits?: number;
      krogerAttempts?: number;
      krogerHits?: number;
    } | null>(),
  ]);
  const walmartAttempts = ledger?.walmartAttempts ?? 0;
  const walmartHits = ledger?.walmartHits ?? 0;
  const krogerAttempts = ledger?.krogerAttempts ?? 0;
  const krogerHits = ledger?.krogerHits ?? 0;
  return {
    day,
    queue: { walmart, kroger },
    hitRate: {
      walmart: rate(walmartHits, walmartAttempts),
      kroger: rate(krogerHits, krogerAttempts),
      walmartAttempts,
      walmartHits,
      krogerAttempts,
      krogerHits,
    },
    mergedToday,
    lookupShare: config.matchLookupShare,
    retryDays: config.matchRetryDays,
    walmartBatch: config.walmartLookupBatch,
  };
}
