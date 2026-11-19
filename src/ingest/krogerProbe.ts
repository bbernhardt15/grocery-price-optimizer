import { KROGER_REFRESH_EMPTY_NOTE, krogerMatchLookupPaused } from "../catalog/krogerLookupFormat";
import { configuredKrogerLookupFormat, krogerProbeCandidates } from "../catalog/normalize";
import { ingestConfig } from "./config";
import { CatalogMaster, IngestCheckpoint } from "./models";
import { MongoBudgetStore, RateGate, type BudgetStore } from "./budget";

export const KROGER_PROBE_DEFAULT = 20;
export const KROGER_PROBE_MAX = 40;

export type KrogerProbeHit = { productId: string; upc: string };

export type KrogerProbeClient = {
  product(input: { code: string; locationId?: string }): Promise<{ httpStatus: number; hits: KrogerProbeHit[] }>;
  term(input: { term: string; locationId?: string }): Promise<{ httpStatus: number; hits: KrogerProbeHit[] }>;
  location(locationId: string): Promise<{ httpStatus: number; valid: boolean }>;
};

export type KrogerProbeAttempt = {
  format: string;
  code: string;
  locationId: string | null;
  httpStatus: number;
  hit: boolean;
  productId: string;
  upc: string;
};

export type KrogerProbeItem = {
  name: string;
  department: string;
  upc: string;
  attempts: KrogerProbeAttempt[];
};

export type KrogerProbeReport = {
  pausedMatchLookup: boolean;
  lookupFormat: string;
  sample: number;
  calls: number;
  stopped: "" | "budget";
  refresh: string;
  locations: Array<{ locationId: string; httpStatus: number; valid: boolean }>;
  items: KrogerProbeItem[];
  summary: {
    byFormat: Record<string, { attempts: number; hits: number; rate: number | null }>;
    byLocation: Record<string, { attempts: number; hits: number; rate: number | null }>;
  };
};

function rate(hits: number, attempts: number): number | null {
  if (attempts <= 0) return null;
  return Math.round((hits / attempts) * 1000) / 1000;
}

function bump(table: Record<string, { attempts: number; hits: number }>, key: string, hit: boolean): void {
  const row = table[key] ?? { attempts: 0, hits: 0 };
  row.attempts += 1;
  if (hit) row.hits += 1;
  table[key] = row;
}

export async function sampleKrogerMisses(limit: number): Promise<Array<{ name: string; departmentId: string; upc: string }>> {
  const cap = Math.max(1, Math.min(KROGER_PROBE_MAX, Math.floor(limit)));
  const rows = await CatalogMaster.find({
    key: { $not: /^local:/ },
    walmartItemId: { $type: "string", $ne: "" },
    matchKrogerAt: { $type: "date" },
    $or: [{ krogerProductId: { $exists: false } }, { krogerProductId: null }, { krogerProductId: "" }],
  })
    .sort({ matchKrogerAt: -1 })
    .limit(cap)
    .select("name departmentId upc")
    .lean<Array<{ name?: string; departmentId?: string; upc?: string }>>();
  return rows.map((row) => ({
    name: String(row.name || ""),
    departmentId: String(row.departmentId || ""),
    upc: String(row.upc || ""),
  }));
}

async function activeLocationIds(): Promise<string[]> {
  const doc = await IngestCheckpoint.findOne({ provider: "kroger" }).lean<{ checkpoint?: { locations?: unknown } } | null>();
  const locations = doc?.checkpoint?.locations;
  if (!Array.isArray(locations)) return [];
  const ids: string[] = [];
  for (const entry of locations) {
    if (!entry || typeof entry !== "object") continue;
    const id = String((entry as { locationId?: unknown }).locationId || "").trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export async function runKrogerProbe(input: {
  limit?: number;
  client: KrogerProbeClient;
  locations?: string[];
  store?: BudgetStore;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  dailyBudget?: number;
  lookupFormat?: string;
  misses?: Array<{ name: string; departmentId: string; upc: string }>;
}): Promise<KrogerProbeReport> {
  const config = ingestConfig();
  const limit = Math.max(1, Math.min(KROGER_PROBE_MAX, Math.floor(input.limit ?? KROGER_PROBE_DEFAULT)));
  const locations = input.locations ?? (await activeLocationIds());
  const store = input.store ?? new MongoBudgetStore();
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = input.now ?? (() => Date.now());
  const gate = new RateGate({
    provider: "kroger",
    dailyBudget: input.dailyBudget ?? config.krogerDailyBudget,
    minIntervalMs: input.minIntervalMs ?? config.krogerMinIntervalMs,
    store,
    now,
    sleep,
  });
  const byFormat: Record<string, { attempts: number; hits: number }> = {};
  const byLocation: Record<string, { attempts: number; hits: number }> = {};
  let calls = 0;
  let stopped: "" | "budget" = "";

  async function charge(): Promise<boolean> {
    const taken = await gate.take();
    if (taken === "budget") {
      stopped = "budget";
      return false;
    }
    calls += 1;
    return true;
  }

  const checked: KrogerProbeReport["locations"] = [];
  for (const locationId of locations) {
    if (!(await charge())) break;
    const result = await input.client.location(locationId);
    checked.push({ locationId, httpStatus: result.httpStatus, valid: result.valid });
  }

  const misses = input.misses ?? (await sampleKrogerMisses(limit));
  const places = [...locations, ""];
  const items: KrogerProbeItem[] = [];
  const seenCall = new Map<string, KrogerProbeAttempt>();

  for (const miss of misses) {
    if (stopped) break;
    const attempts: KrogerProbeAttempt[] = [];
    const candidates = [
      ...krogerProbeCandidates(miss.upc),
      { format: "term" as const, code: miss.name },
    ];
    for (const place of places) {
      if (stopped) break;
      for (const candidate of candidates) {
        if (!candidate.code) continue;
        const key = `${candidate.format}|${place}|${candidate.code}`;
        const sharedKey = `${place}|${candidate.code}|${candidate.format === "term" ? "term" : "id"}`;
        const prior = seenCall.get(sharedKey);
        if (prior && prior.format !== candidate.format) {
          const copy = { ...prior, format: candidate.format };
          attempts.push(copy);
          bump(byFormat, candidate.format, copy.hit);
          continue;
        }
        if (!(await charge())) break;
        const result =
          candidate.format === "term"
            ? await input.client.term({ term: candidate.code, ...(place ? { locationId: place } : {}) })
            : await input.client.product({ code: candidate.code, ...(place ? { locationId: place } : {}) });
        const hit = result.hits[0];
        const attempt: KrogerProbeAttempt = {
          format: candidate.format,
          code: candidate.code,
          locationId: place || null,
          httpStatus: result.httpStatus,
          hit: result.hits.length > 0,
          productId: hit?.productId || "",
          upc: hit?.upc || "",
        };
        attempts.push(attempt);
        seenCall.set(key, attempt);
        seenCall.set(sharedKey, attempt);
        bump(byFormat, candidate.format, attempt.hit);
        bump(byLocation, place || "none", attempt.hit);
      }
    }
    items.push({ name: miss.name, department: miss.departmentId, upc: miss.upc, attempts });
  }

  const finish = (table: Record<string, { attempts: number; hits: number }>) => {
    const out: KrogerProbeReport["summary"]["byFormat"] = {};
    for (const [key, row] of Object.entries(table)) {
      out[key] = { ...row, rate: rate(row.hits, row.attempts) };
    }
    return out;
  };

  return {
    pausedMatchLookup: krogerMatchLookupPaused(),
    lookupFormat: input.lookupFormat || configuredKrogerLookupFormat(),
    sample: items.length,
    calls,
    stopped,
    refresh: KROGER_REFRESH_EMPTY_NOTE,
    locations: checked,
    items,
    summary: { byFormat: finish(byFormat), byLocation: finish(byLocation) },
  };
}
