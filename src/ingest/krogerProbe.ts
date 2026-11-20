import { randomUUID } from "node:crypto";
import { KROGER_REFRESH_EMPTY_NOTE, krogerMatchLookupPaused } from "../catalog/krogerLookupFormat";
import { configuredKrogerLookupFormat, krogerProbeCandidates } from "../catalog/normalize";
import { buildKrogerSearchTerm } from "../krogerSearchTerm";
import { ingestConfig } from "./config";
import { MongoBudgetStore, RateGate, type BudgetStore } from "./budget";
import { CatalogMaster, IngestCheckpoint } from "./models";
import { acquireIngestLock, releaseIngestLock, renewIngestLock } from "./runner";

export const KROGER_PROBE_DEFAULT = 20;
export const KROGER_PROBE_MAX = 40;
/**
 * Largest sample to ask for. With one saved store the work is one location
 * check plus 3 misses × 5 shapes × 2 places × 2500ms, about 78 seconds.
 * Railway closes an HTTP request that has sent no bytes after 5 minutes
 * (and some edges drop a silent response nearer 60 seconds). The POST does
 * not stay open: it returns 202 and the result is polled. A larger limit
 * holds the Kroger ingest lock until the job finishes.
 */
export const KROGER_PROBE_SAFE_LIMIT = 3;

export type KrogerProbeHit = { productId: string; upc: string };

export type KrogerProbeClient = {
  product(input: { code: string; locationId?: string }): Promise<{ httpStatus: number; hits: KrogerProbeHit[] }>;
  term(input: { term: string; locationId?: string }): Promise<{ httpStatus: number; hits: KrogerProbeHit[] }>;
  location(locationId: string): Promise<{ httpStatus: number; valid: boolean }>;
};

export type KrogerProbeAttempt = {
  format: string;
  code: string;
  /** `filter.term` or `filter.productId`. A name is never sent as a product id. */
  query: "filter.term" | "filter.productId";
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
  safeLimit: number;
  sample: number;
  calls: number;
  stopped: "" | "budget" | "busy";
  refresh: string;
  locations: Array<{ locationId: string; httpStatus: number; valid: boolean }>;
  items: KrogerProbeItem[];
  summary: {
    byFormat: Record<string, { attempts: number; hits: number; rate: number | null }>;
    byLocation: Record<string, { attempts: number; hits: number; rate: number | null }>;
  };
};

export type KrogerProbeJob = {
  id: string;
  status: "running" | "done" | "error" | "busy";
  safeLimit: number;
  poll: string;
  calls: number;
  report: KrogerProbeReport | null;
  error: string;
};

export type ProbeLock = {
  renew: () => Promise<boolean>;
  release: () => Promise<void>;
};

export type SharedKrogerGate = {
  charge: () => Promise<boolean>;
  stopped: () => "" | "budget" | "busy";
  calls: () => number;
  close: () => Promise<void>;
};

const jobs = new Map<string, KrogerProbeJob>();

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

function finishTable(table: Record<string, { attempts: number; hits: number }>): KrogerProbeReport["summary"]["byFormat"] {
  const out: KrogerProbeReport["summary"]["byFormat"] = {};
  for (const [key, row] of Object.entries(table)) {
    out[key] = { ...row, rate: rate(row.hits, row.attempts) };
  }
  return out;
}

export async function sampleKrogerMisses(
  limit: number
): Promise<Array<{ name: string; brand: string; departmentId: string; upc: string }>> {
  const cap = Math.max(1, Math.min(KROGER_PROBE_MAX, Math.floor(limit)));
  const rows = await CatalogMaster.find({
    key: { $not: /^local:/ },
    walmartItemId: { $type: "string", $ne: "" },
    matchKrogerAt: { $type: "date" },
    $or: [{ krogerProductId: { $exists: false } }, { krogerProductId: null }, { krogerProductId: "" }],
  })
    .sort({ matchKrogerAt: -1 })
    .limit(cap)
    .select("name brand departmentId upc")
    .lean<Array<{ name?: string; brand?: string; departmentId?: string; upc?: string }>>();
  return rows.map((row) => ({
    name: String(row.name || ""),
    brand: String(row.brand || ""),
    departmentId: String(row.departmentId || ""),
    upc: String(row.upc || ""),
  }));
}

export async function activeKrogerLocationIds(): Promise<string[]> {
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

async function readKrogerNextAllowedAt(): Promise<number> {
  const doc = await IngestCheckpoint.findOne({ provider: "kroger" }).lean<{
    checkpoint?: { nextAllowedAt?: unknown };
  } | null>();
  const raw = doc?.checkpoint?.nextAllowedAt;
  const parsed = typeof raw === "string" ? Date.parse(raw) : typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

async function writeKrogerNextAllowedAt(ms: number): Promise<void> {
  if (!(ms > 0)) return;
  await IngestCheckpoint.updateOne(
    { provider: "kroger" },
    { $set: { "checkpoint.nextAllowedAt": new Date(ms).toISOString() } },
    { upsert: true }
  );
}

function shellReport(input: { lookupFormat?: string }, stopped: KrogerProbeReport["stopped"]): KrogerProbeReport {
  return {
    pausedMatchLookup: krogerMatchLookupPaused(),
    lookupFormat: input.lookupFormat || configuredKrogerLookupFormat(),
    safeLimit: KROGER_PROBE_SAFE_LIMIT,
    sample: 0,
    calls: 0,
    stopped,
    refresh: KROGER_REFRESH_EMPTY_NOTE,
    locations: [],
    items: [],
    summary: { byFormat: {}, byLocation: {} },
  };
}

/** The cleaned `filter.term` for a catalog title. Null when the name has no words left. */
export function krogerProbeTerm(name: string): string | null {
  return buildKrogerSearchTerm(name);
}

/**
 * One Kroger pacing gate shared with ingest. Holds the ingest lock when this
 * process is the caller, and reads and writes checkpoint nextAllowedAt.
 */
export async function openSharedKrogerGate(input: {
  store?: BudgetStore;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  dailyBudget?: number;
  holdLock?: () => Promise<ProbeLock | null>;
  readNextAllowedAt?: () => Promise<number>;
  writeNextAllowedAt?: (ms: number) => Promise<void>;
}): Promise<SharedKrogerGate | "busy"> {
  const config = ingestConfig();
  let renew: (() => Promise<boolean>) | undefined;
  let release: (() => Promise<void>) | undefined;
  let readNext = input.readNextAllowedAt;
  let writeNext = input.writeNextAllowedAt;

  if (input.holdLock) {
    const held = await input.holdLock();
    if (!held) return "busy";
    renew = held.renew;
    release = held.release;
  } else if (!input.store) {
    const owner = await acquireIngestLock();
    if (!owner) return "busy";
    renew = () => renewIngestLock(owner);
    release = () => releaseIngestLock(owner);
    readNext = readNext ?? readKrogerNextAllowedAt;
    writeNext = writeNext ?? writeKrogerNextAllowedAt;
  }

  const store = input.store ?? new MongoBudgetStore();
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = input.now ?? (() => Date.now());
  const initialNextAt = readNext ? await readNext() : 0;
  const gate = new RateGate({
    provider: "kroger",
    dailyBudget: input.dailyBudget ?? config.krogerDailyBudget,
    minIntervalMs: input.minIntervalMs ?? config.krogerMinIntervalMs,
    store,
    now,
    sleep,
    initialNextAt,
  });
  let calls = 0;
  let stopped: "" | "budget" | "busy" = "";
  let closed = false;

  return {
    async charge() {
      if (stopped) return false;
      if (renew) {
        const held = await renew();
        if (!held) {
          stopped = "busy";
          return false;
        }
      }
      const taken = await gate.take();
      if (writeNext) await writeNext(gate.nextAllowedAt());
      if (taken === "budget") {
        stopped = "budget";
        return false;
      }
      calls += 1;
      return true;
    },
    stopped: () => stopped,
    calls: () => calls,
    async close() {
      if (closed) return;
      closed = true;
      if (release) await release().catch(() => undefined);
    },
  };
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
  /** When set, the probe uses this lock instead of the ingest lock. Null means the lock is busy. */
  holdLock?: () => Promise<ProbeLock | null>;
  readNextAllowedAt?: () => Promise<number>;
  writeNextAllowedAt?: (ms: number) => Promise<void>;
  onProgress?: (report: KrogerProbeReport) => void;
}): Promise<KrogerProbeReport> {
  const limit = Math.max(1, Math.min(KROGER_PROBE_MAX, Math.floor(input.limit ?? KROGER_PROBE_DEFAULT)));
  const gate = await openSharedKrogerGate(input);
  if (gate === "busy") return shellReport(input, "busy");

  try {
    const locations = input.locations ?? (await activeKrogerLocationIds());
    const byFormat: Record<string, { attempts: number; hits: number }> = {};
    const byLocation: Record<string, { attempts: number; hits: number }> = {};

    const checked: KrogerProbeReport["locations"] = [];
    for (const locationId of locations) {
      if (!(await gate.charge())) break;
      const result = await input.client.location(locationId);
      checked.push({ locationId, httpStatus: result.httpStatus, valid: result.valid });
    }

    const misses = gate.stopped() ? [] : (input.misses ?? (await sampleKrogerMisses(limit)));
    const places = [...locations, ""];
    const items: KrogerProbeItem[] = [];
    const seenCall = new Map<string, KrogerProbeAttempt>();

    const snapshot = (): KrogerProbeReport => ({
      pausedMatchLookup: krogerMatchLookupPaused(),
      lookupFormat: input.lookupFormat || configuredKrogerLookupFormat(),
      safeLimit: KROGER_PROBE_SAFE_LIMIT,
      sample: items.length,
      calls: gate.calls(),
      stopped: gate.stopped(),
      refresh: KROGER_REFRESH_EMPTY_NOTE,
      locations: checked,
      items,
      summary: { byFormat: finishTable(byFormat), byLocation: finishTable(byLocation) },
    });

    for (const miss of misses) {
      if (gate.stopped()) break;
      const attempts: KrogerProbeAttempt[] = [];
      const term = krogerProbeTerm(miss.name);
      const candidates: Array<{ format: string; code: string; query: KrogerProbeAttempt["query"] }> = [
        ...krogerProbeCandidates(miss.upc).map((row) => ({
          format: row.format,
          code: row.code,
          query: "filter.productId" as const,
        })),
      ];
      if (term) candidates.push({ format: "term", code: term, query: "filter.term" });
      for (const place of places) {
        if (gate.stopped()) break;
        for (const candidate of candidates) {
          if (!candidate.code) continue;
          const key = `${candidate.format}|${place}|${candidate.code}`;
          const sharedKey = `${place}|${candidate.code}|${candidate.format === "term" ? "term" : "id"}`;
          const prior = seenCall.get(sharedKey);
          if (prior && prior.format !== candidate.format) {
            const copy = { ...prior, format: candidate.format, query: candidate.query };
            attempts.push(copy);
            bump(byFormat, candidate.format, copy.hit);
            continue;
          }
          if (!(await gate.charge())) break;
          const result =
            candidate.query === "filter.term"
              ? await input.client.term({ term: candidate.code, ...(place ? { locationId: place } : {}) })
              : await input.client.product({ code: candidate.code, ...(place ? { locationId: place } : {}) });
          const hit = result.hits[0];
          const attempt: KrogerProbeAttempt = {
            format: candidate.format,
            code: candidate.code,
            query: candidate.query,
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
      input.onProgress?.(snapshot());
    }

    const report = snapshot();
    input.onProgress?.(report);
    return report;
  } finally {
    await gate.close();
  }
}

export function startKrogerProbeJob(
  limit: number,
  run: (limit: number, onProgress: (report: KrogerProbeReport) => void) => Promise<KrogerProbeReport>
): KrogerProbeJob {
  const id = randomUUID();
  const job: KrogerProbeJob = {
    id,
    status: "running",
    safeLimit: KROGER_PROBE_SAFE_LIMIT,
    poll: `/api/admin/kroger/probe/${id}`,
    calls: 0,
    report: null,
    error: "",
  };
  jobs.set(id, job);
  while (jobs.size > 8) {
    const oldest = jobs.keys().next().value;
    if (!oldest || oldest === id) break;
    jobs.delete(oldest);
  }
  void run(limit, (report) => {
    job.calls = report.calls;
    job.report = report;
  })
    .then((report) => {
      job.report = report;
      job.calls = report.calls;
      job.status = report.stopped === "busy" ? "busy" : "done";
    })
    .catch((error: unknown) => {
      job.status = "error";
      job.error = (error instanceof Error ? error.message : "Kroger probe failed")
        .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/client_secret=\S+/gi, "client_secret=[redacted]");
    });
  return job;
}

export function krogerProbeJob(id: string): KrogerProbeJob | null {
  return jobs.get(id) ?? null;
}
