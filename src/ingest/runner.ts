import { randomUUID } from "node:crypto";
import { demoRecords } from "../catalog/demoCatalog";
import { krogerProductIdForLookup, upcKey } from "../catalog/normalize";
import type { RawCatalogRecord } from "../catalog/types";
import { krogerApiConfigured } from "../pricing/krogerProvider";
import { walmartPricingProvider } from "../pricing/walmartProvider";
import {
  CallBudgetExceeded,
  chargeCall,
  backoffDelayMs,
  httpStatusOf,
  ingestErrorDetail,
  MongoBudgetStore,
  RateGate,
  retryClass,
  WALMART_RATE_HALT_STRIKES,
  walmartCooldownUntil,
  type BudgetStore,
  type IngestErrorDetail,
} from "./budget";
import { krogerProductsClient, walmartAffiliateClient, type KrogerCatalogClient, type WalmartCatalogClient } from "./clients";
import { effectiveShares, ingestConfig, nextTickTurn, refreshShareFor, tickCallSplit, type IngestConfig } from "./config";
import {
  KROGER_TERMS_VERSION,
  krogerAdvance,
  krogerQueries,
  krogerStartParam,
  pickBrandSplits,
  sanitizeKrogerParam,
} from "./krogerTerms";
import { finishLookups, nextKrogerLookups, nextWalmartLookups, type LookupPick } from "./crossLookup";
import { finishRefresh, loadStaleRatio, nextRefreshPicks } from "./refresh";
import { scanPriceDropAlerts } from "./maintenance";
import { IngestCheckpoint, IngestLock, ShopperZip } from "./models";
import { markStaleCatalog, upsertCatalogRecords } from "./upsert";
import {
  WALMART_TAXONOMY_VERSION,
  groceryLeaves,
  isWalmartEndpointMiss,
  normalizeWalmartPage,
  recordsFromWalmartPage,
  walmartNextCursor,
  type WalmartCategory,
  type WalmartPagePlan,
} from "./walmartWalk";

const LOCK_ID = "catalog-ingest";
const LOCK_MS = 180_000;
const MAX_ATTEMPTS = 5;
const KROGER_LOCATION_ERROR_LIMIT = 3;

export type WalmartCheckpoint = {
  phase: "taxonomy" | "categories" | "done";
  /** Bump WALMART_TAXONOMY_VERSION to re-read the tree (grocery leaves vs general merchandise). */
  taxonomyVersion: number;
  categories: WalmartCategory[];
  index: number;
  nextPage: string | null;
  /**
   * The stored nextPage was rejected. The next attempt rebuilds
   * `/paginated/items` from the category id and page cursor.
   */
  pageFallback?: boolean;
  attempts: number;
  rateStrikes: number;
  /** Clean pages since the last 429. Three in a row clear the strike count. */
  successStreak: number;
  /** UPC lookups of Kroger-only masters. Charged on the Walmart budget. */
  matchAttempts: number;
  matchHits: number;
  /** A 400 on a multi-UPC lookup switches this cycle to one UPC per call. */
  lookupSingle?: boolean;
  cooldownUntil?: string;
  nextAllowedAt?: string;
  cycleStartedAt: string;
};

export type KrogerLocationPlan = { zip: string; locationId: string };

export type KrogerCheckpoint = {
  termsVersion: number;
  phase: "locations" | "queries" | "done";
  plannedZips: string[];
  zipCursor: number;
  locations: KrogerLocationPlan[];
  locationIndex: number;
  queryIndex: number;
  start: number;
  pageIndex: number;
  attempts: number;
  /** Brands still to run for the current term after filter.start hits 250. */
  brandSplits?: string[];
  /** Brand applied on top of the current term. Unset during the unbranded pass. */
  splitBrand?: string;
  /** Brands seen on the unbranded pass, used if the start ceiling is hit. */
  seenBrands?: string[];
  /** UPC lookups of Walmart-only masters. Charged on the Kroger budget. */
  matchAttempts: number;
  matchHits: number;
  pendingZips: string[];
  clientErrorStreak: number;
  clientErrorLocationId?: string;
  /** Name search still owed after filter.productId missed. Not a discovery error. */
  termFallback?: KrogerTermFallback;
  nextAllowedAt?: string;
  cycleStartedAt: string;
};

type KrogerTermFallback = {
  key: string;
  name: string;
  code: string;
  upc?: string;
  locationId?: string;
};

type CheckpointDoc = {
  provider: string;
  status?: string;
  checkpoint?: unknown;
  recentErrors?: unknown[];
  calls?: number;
  upserted?: number;
  cycles?: number;
};

type PersistExtra = {
  error?: IngestErrorDetail;
  lastError?: string;
  clearError?: boolean;
  finished?: boolean;
  cycle?: boolean;
};

export type SliceResult = {
  provider: string;
  calls: number;
  upserted: number;
  paused: string | null;
};

function emptyWalmart(now: Date): WalmartCheckpoint {
  return {
    phase: "taxonomy",
    taxonomyVersion: WALMART_TAXONOMY_VERSION,
    categories: [],
    index: 0,
    nextPage: null,
    attempts: 0,
    rateStrikes: 0,
    successStreak: 0,
    matchAttempts: 0,
    matchHits: 0,
    cycleStartedAt: now.toISOString(),
  };
}

function emptyKroger(now: Date): KrogerCheckpoint {
  return {
    termsVersion: KROGER_TERMS_VERSION,
    phase: "locations",
    plannedZips: [],
    zipCursor: 0,
    locations: [],
    locationIndex: 0,
    queryIndex: 0,
    start: 0,
    pageIndex: 0,
    attempts: 0,
    pendingZips: [],
    clientErrorStreak: 0,
    matchAttempts: 0,
    matchHits: 0,
    cycleStartedAt: now.toISOString(),
  };
}

function asWalmart(value: unknown, now: Date): WalmartCheckpoint {
  const record = value && typeof value === "object" ? (value as Partial<WalmartCheckpoint>) : {};
  return {
    ...emptyWalmart(now),
    ...record,
    categories: Array.isArray(record.categories) ? record.categories : [],
    rateStrikes: typeof record.rateStrikes === "number" ? record.rateStrikes : 0,
    successStreak: typeof record.successStreak === "number" ? record.successStreak : 0,
    taxonomyVersion: typeof record.taxonomyVersion === "number" ? record.taxonomyVersion : 0,
    matchAttempts: typeof record.matchAttempts === "number" ? record.matchAttempts : 0,
    matchHits: typeof record.matchHits === "number" ? record.matchHits : 0,
    lookupSingle: record.lookupSingle === true,
  };
}

function asKroger(value: unknown, now: Date): KrogerCheckpoint {
  const record = value && typeof value === "object" ? (value as Partial<KrogerCheckpoint>) : {};
  return {
    ...emptyKroger(now),
    ...record,
    locations: Array.isArray(record.locations) ? record.locations : [],
    plannedZips: Array.isArray(record.plannedZips) ? record.plannedZips : [],
    pendingZips: Array.isArray(record.pendingZips) ? record.pendingZips.filter((zip) => /^\d{5}$/.test(zip)) : [],
    clientErrorStreak: typeof record.clientErrorStreak === "number" ? record.clientErrorStreak : 0,
    brandSplits: Array.isArray(record.brandSplits) ? record.brandSplits.filter((brand) => typeof brand === "string") : [],
    seenBrands: Array.isArray(record.seenBrands) ? record.seenBrands.filter((brand) => typeof brand === "string") : [],
    splitBrand: typeof record.splitBrand === "string" ? record.splitBrand : undefined,
    matchAttempts: typeof record.matchAttempts === "number" ? record.matchAttempts : 0,
    matchHits: typeof record.matchHits === "number" ? record.matchHits : 0,
    termFallback: readKrogerTermFallback(record.termFallback),
  };
}

function readKrogerTermFallback(value: unknown): KrogerTermFallback | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const row = value as Partial<KrogerTermFallback>;
  if (typeof row.key !== "string" || typeof row.name !== "string" || typeof row.code !== "string") {
    return undefined;
  }
  return {
    key: row.key,
    name: row.name,
    code: row.code,
    ...(typeof row.upc === "string" && row.upc ? { upc: row.upc } : {}),
    ...(typeof row.locationId === "string" && row.locationId ? { locationId: row.locationId } : {}),
  };
}

/** A lookup 400 is a miss. It does not join the discovery error streak. */
function krogerClientMiss(error: unknown): boolean {
  const status = httpStatusOf(error);
  return status !== null && status >= 400 && status < 500 && status !== 429;
}

function krogerRecordMatches(record: RawCatalogRecord, masterKey: string, expected: string): boolean {
  const id = (record.productId || record.retailerItemId || "").replace(/\D/g, "");
  if (id && (id === expected || krogerProductIdForLookup(id) === expected)) {
    return true;
  }
  const key = upcKey(record.upc) || upcKey(id);
  return Boolean(key && key === masterKey);
}

function bindKrogerLookupRecords(
  records: RawCatalogRecord[],
  pick: { key: string; code: string; upc?: string },
  mode: "id" | "term"
): RawCatalogRecord[] {
  const expected = pick.code.replace(/\D/g, "");
  const chosen = mode === "id" ? records : records.filter((record) => krogerRecordMatches(record, pick.key, expected));
  const upc = pick.upc?.replace(/\D/g, "");
  return chosen.map((record) => {
    const productId = (record.productId || record.retailerItemId || expected).trim();
    return {
      ...record,
      ...(upc ? { upc } : {}),
      ...(productId ? { productId, retailerItemId: record.retailerItemId?.trim() || productId } : {}),
    };
  });
}

function lookupPickFromTerm(pending: KrogerTermFallback): LookupPick {
  return {
    key: pending.key,
    name: pending.name,
    code: pending.code,
    codes: [pending.code],
    variantIndex: 0,
    priority: "catalog",
    ...(pending.upc ? { upc: pending.upc } : {}),
  };
}

async function loadCheckpoint(provider: string): Promise<CheckpointDoc> {
  const doc = await IngestCheckpoint.findOne({ provider }).lean<CheckpointDoc | null>();
  return doc ?? { provider, checkpoint: {}, recentErrors: [], calls: 0, upserted: 0, cycles: 0 };
}

async function saveCheckpoint(
  provider: string,
  checkpoint: unknown,
  patch: {
    status: string;
    lastError?: string;
    error?: IngestErrorDetail;
    calls?: number;
    upserted?: number;
    finished?: boolean;
    cycle?: boolean;
  }
): Promise<void> {
  const callDelta = patch.calls && patch.calls > 0 ? patch.calls : 0;
  const upsertDelta = patch.upserted && patch.upserted > 0 ? patch.upserted : 0;
  const errors = patch.error ? [patch.error] : [];
  const lastError = patch.error ? patch.error.message : patch.lastError;
  await IngestCheckpoint.findOneAndUpdate(
    { provider },
    {
      $set: {
        provider,
        checkpoint,
        status: patch.status,
        ...(lastError !== undefined ? { lastError } : {}),
        ...(patch.finished ? { lastFinishedAt: new Date() } : {}),
      },
      $inc: {
        ...(callDelta ? { calls: callDelta } : {}),
        ...(upsertDelta ? { upserted: upsertDelta } : {}),
        ...(patch.cycle ? { cycles: 1 } : {}),
      },
      ...(errors.length > 0 ? { $push: { recentErrors: { $each: errors, $slice: -20 } } } : {}),
      $setOnInsert: { lastStartedAt: new Date() },
    },
    { upsert: true }
  );
}

function refreshDue(cycleStartedAt: string, refreshHours: number, now: Date): boolean {
  const started = Date.parse(cycleStartedAt);
  if (!Number.isFinite(started)) {
    return true;
  }
  return now.getTime() - started >= refreshHours * 3_600_000;
}

function gateFor(
  provider: string,
  budget: number,
  minIntervalMs: number,
  store: BudgetStore,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
  initialNextAt?: number
): RateGate {
  return new RateGate({ provider, dailyBudget: budget, minIntervalMs, store, now, sleep, initialNextAt });
}

/** Ledger consume and the run-counter increment live in this one call. */
async function spendCall<T>(gate: RateGate, run: () => Promise<T>, count: () => void, stamp: () => void): Promise<T | "budget"> {
  try {
    const value = await chargeCall(gate, run, count);
    stamp();
    return value;
  } catch (error) {
    if (error instanceof CallBudgetExceeded) {
      return "budget";
    }
    stamp();
    throw error;
  }
}

function epochMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const WALMART_CLEAN_PAGES_TO_CLEAR = 3;

/** One good page does not forgive a 429. Three clean pages in a row do. */
function noteWalmartSuccess(cp: WalmartCheckpoint): void {
  cp.successStreak += 1;
  cp.attempts = 0;
  delete cp.cooldownUntil;
  if (cp.successStreak >= WALMART_CLEAN_PAGES_TO_CLEAR) {
    cp.rateStrikes = 0;
    cp.successStreak = 0;
  }
}

/** A day-long halt expires into a fresh strike count so the next UTC day can try again. */
function releaseWalmartHalt(cp: WalmartCheckpoint, now: Date): void {
  if (cp.rateStrikes < WALMART_RATE_HALT_STRIKES) {
    return;
  }
  const until = epochMs(cp.cooldownUntil);
  if (until > 0 && until <= now.getTime()) {
    cp.rateStrikes = 0;
    cp.successStreak = 0;
    delete cp.cooldownUntil;
  }
}

async function tickSplitFor(
  store: "walmart" | "kroger",
  maxCalls: number,
  config: IngestConfig,
  staleRatio: number | undefined
): Promise<{ lookup: number; refresh: number; discovery: number; refreshFirst: boolean }> {
  const ratio = staleRatio ?? (await loadStaleRatio());
  const shares = effectiveShares({
    staleRatio: ratio,
    lookupShare: config.matchLookupShare,
    refreshShare: refreshShareFor(config, store),
  });
  return {
    ...tickCallSplit(maxCalls, shares.lookupShare, shares.refreshShare, shares.refreshFirst),
    refreshFirst: shares.refreshFirst,
  };
}

function logWalmartPagePlan(categoryId: string, stored: string | null, plan: WalmartPagePlan): void {
  if (!plan.note) {
    return;
  }
  const storedText = (stored ?? "").replace(/([?&]publisherId=)[^&]*/gi, "$1[redacted]").slice(0, 160);
  const line = `Walmart pagination: ${plan.note} category=${categoryId} fallback=${plan.fallback} path=${plan.path} stored=${storedText}`;
  if (plan.fallback) {
    console.warn(line);
  } else {
    console.info(line);
  }
}

function skipWalmartCategory(cp: WalmartCheckpoint): void {
  cp.index += 1;
  cp.nextPage = null;
  cp.attempts = 0;
  cp.pageFallback = false;
}

export async function stepWalmart(options: {
  client: WalmartCatalogClient;
  maxCalls: number;
  store?: BudgetStore;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  config?: IngestConfig;
  /** Shelf stale ratio. Omit to count offers in Mongo. */
  staleRatio?: number;
}): Promise<SliceResult> {
  const config = options.config ?? ingestConfig();
  const nowFn = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const store = options.store ?? new MongoBudgetStore();
  const doc = await loadCheckpoint("walmart");
  let cp = asWalmart(doc.checkpoint, nowFn());
  const gate = gateFor(
    "walmart",
    config.walmartDailyBudget,
    config.walmartMinIntervalMs,
    store,
    () => nowFn().getTime(),
    sleep,
    epochMs(cp.nextAllowedAt)
  );
  let calls = 0;
  let upserted = 0;
  let paused: string | null = null;
  let countedCalls = 0;
  let countedUpserts = 0;
  const split = await tickSplitFor("walmart", options.maxCalls, config, options.staleRatio);
  const lookupBudget = split.lookup;
  const refreshBudget = split.refresh;
  const refreshFirst = split.refreshFirst;
  let lookupsDone = 0;
  let lookupExhausted = false;
  let refreshesDone = 0;
  let refreshExhausted = false;
  const lookupUpcs =
    options.client.lookupUpcs ??
    (options.client.lookupUpc ? (upcs: string[]) => options.client.lookupUpc!(upcs.join(",")) : undefined);

  const stampPace = () => {
    const nextAt = gate.nextAllowedAt();
    if (nextAt > 0) {
      cp.nextAllowedAt = new Date(nextAt).toISOString();
    }
  };

  const persist = async (status: string, extra?: PersistExtra) => {
    const callDelta = calls - countedCalls;
    const upsertDelta = upserted - countedUpserts;
    countedCalls = calls;
    countedUpserts = upserted;
    await saveCheckpoint("walmart", cp, {
      status,
      calls: callDelta,
      upserted: upsertDelta,
      ...(extra?.error ? { error: extra.error } : {}),
      ...(extra?.clearError ? { lastError: "" } : {}),
      ...(extra?.lastError !== undefined ? { lastError: extra.lastError } : {}),
      ...(extra?.finished ? { finished: true } : {}),
      ...(extra?.cycle ? { cycle: true } : {}),
    });
  };

  while (calls < options.maxCalls) {
    const cooldownAt = epochMs(cp.cooldownUntil);
    if (cooldownAt > nowFn().getTime()) {
      paused = "cooldown";
      await persist("paused");
      break;
    }
    releaseWalmartHalt(cp, nowFn());
    if (cp.taxonomyVersion !== WALMART_TAXONOMY_VERSION) {
      cp.taxonomyVersion = WALMART_TAXONOMY_VERSION;
      cp.phase = "taxonomy";
      cp.categories = [];
      cp.index = 0;
      cp.nextPage = null;
      cp.pageFallback = false;
    }
    const turn = nextTickTurn({
      refreshFirst,
      lookupPending: Boolean(lookupUpcs) && !lookupExhausted,
      refreshPending: Boolean(lookupUpcs) && !refreshExhausted,
      lookupsDone,
      lookupBudget,
      refreshesDone,
      refreshBudget,
    });
    if (turn === "lookup" && lookupUpcs) {
      const limit = cp.lookupSingle ? 1 : config.walmartLookupBatch;
      const picks = await nextWalmartLookups(nowFn(), limit);
      if (picks.length === 0) {
        lookupExhausted = true;
        continue;
      } else {
        const codes = [...new Set(picks.map((pick) => pick.code))];
        const params = { request: "items", upc: codes.join(",").slice(0, 300) };
        lookupsDone += 1;
        try {
          const charged = await spendCall(
            gate,
            () => lookupUpcs(codes),
            () => {
              calls += 1;
            },
            stampPace
          );
          if (charged === "budget") {
            paused = "budget";
            await persist("paused", { lastError: "Walmart daily budget reached" });
            break;
          }
          const records = recordsFromWalmartPage(charged);
          if (records.length > 0) {
            const saved = await upsertCatalogRecords(records, nowFn());
            upserted += saved.offers;
          }
          const finished = await finishLookups("walmart", picks, nowFn());
          cp.matchAttempts += finished.attempts;
          cp.matchHits += finished.hits;
          noteWalmartSuccess(cp);
          await persist("running", { clearError: true });
        } catch (error) {
          const kind = retryClass(error);
          if (kind === "rate") {
            const outcome = await failWalmart(cp, error, sleep, nowFn(), params);
            cp = outcome.checkpoint;
            paused = outcome.paused;
            await persist(outcome.status, { error: outcome.error });
            if (outcome.stop) {
              break;
            }
          } else if (kind === "fatal" && httpStatusOf(error) === 400 && picks.length > 1) {
            cp.lookupSingle = true;
            cp.attempts = 0;
            await persist("running", { error: ingestErrorDetail("walmart", error, params, nowFn()) });
          } else if (kind === "fatal" || cp.attempts >= 2) {
            const finished = await finishLookups("walmart", picks, nowFn(), { forceMiss: true });
            cp.matchAttempts += finished.attempts;
            cp.attempts = 0;
            await persist("running", { error: ingestErrorDetail("walmart", error, params, nowFn()) });
          } else {
            const outcome = await failWalmart(cp, error, sleep, nowFn(), params);
            cp = outcome.checkpoint;
            paused = outcome.paused;
            await persist(outcome.status, { error: outcome.error });
            if (outcome.stop) {
              break;
            }
          }
        }
        continue;
      }
    }
    if (turn === "refresh" && lookupUpcs) {
      const limit = cp.lookupSingle ? 1 : config.walmartLookupBatch;
      const picks = await nextRefreshPicks("Walmart", nowFn(), limit);
      if (picks.length === 0) {
        refreshExhausted = true;
        continue;
      } else {
        const codes = picks.map((pick) => pick.code);
        const params = { request: "items", upc: codes.join(",").slice(0, 300), refresh: true };
        refreshesDone += 1;
        try {
          const charged = await spendCall(
            gate,
            () => lookupUpcs(codes),
            () => {
              calls += 1;
            },
            stampPace
          );
          if (charged === "budget") {
            paused = "budget";
            await persist("paused", { lastError: "Walmart daily budget reached" });
            break;
          }
          const records = recordsFromWalmartPage(charged);
          let refreshed = 0;
          if (records.length > 0) {
            const saved = await upsertCatalogRecords(records, nowFn());
            upserted += saved.offers;
            refreshed = saved.offers;
          }
          await finishRefresh(picks, nowFn(), refreshed);
          noteWalmartSuccess(cp);
          await persist("running", { clearError: true });
        } catch (error) {
          const kind = retryClass(error);
          if (kind === "rate") {
            const outcome = await failWalmart(cp, error, sleep, nowFn(), params);
            cp = outcome.checkpoint;
            paused = outcome.paused;
            await persist(outcome.status, { error: outcome.error });
            if (outcome.stop) {
              break;
            }
          } else if (kind === "fatal" && httpStatusOf(error) === 400 && picks.length > 1) {
            cp.lookupSingle = true;
            cp.attempts = 0;
            await persist("running", { error: ingestErrorDetail("walmart", error, params, nowFn()) });
          } else if (kind === "fatal" || cp.attempts >= 2) {
            await finishRefresh(picks, nowFn(), 0);
            cp.attempts = 0;
            await persist("running", { error: ingestErrorDetail("walmart", error, params, nowFn()) });
          } else {
            const outcome = await failWalmart(cp, error, sleep, nowFn(), params);
            cp = outcome.checkpoint;
            paused = outcome.paused;
            await persist(outcome.status, { error: outcome.error });
            if (outcome.stop) {
              break;
            }
          }
        }
        continue;
      }
    }
    if (cp.phase === "done" && refreshDue(cp.cycleStartedAt, config.refreshHours, nowFn())) {
      cp = { ...emptyWalmart(nowFn()), phase: "categories", categories: cp.categories, nextAllowedAt: cp.nextAllowedAt };
    }
    if (cp.phase === "taxonomy" || (cp.phase === "categories" && cp.categories.length === 0 && cp.index === 0)) {
      try {
        const charged = await spendCall(gate, () => options.client.taxonomy(), () => {
          calls += 1;
        }, stampPace);
        if (charged === "budget") {
          paused = "budget";
          await persist("paused", { lastError: "Walmart daily budget reached" });
          break;
        }
        const taxonomy = charged;
        cp.categories = groceryLeaves(taxonomy);
        cp.phase = cp.categories.length === 0 ? "done" : "categories";
        cp.index = 0;
        cp.nextPage = null;
        noteWalmartSuccess(cp);
        if (cp.phase === "done") {
          await persist("completed", { finished: true, cycle: true, clearError: true });
          break;
        }
        await persist("running", { cycle: true, clearError: true });
      } catch (error) {
        const outcome = await failWalmart(cp, error, sleep, nowFn(), { request: "taxonomy" });
        cp = outcome.checkpoint;
        paused = outcome.paused;
        await persist(outcome.status, { error: outcome.error });
        if (outcome.stop) {
          break;
        }
      }
      continue;
    }

    if (cp.phase === "done" || cp.index >= cp.categories.length) {
      cp.phase = "done";
      await persist("completed", { finished: true });
      break;
    }

    const category = cp.categories[cp.index];
    const plan = normalizeWalmartPage(category.id, cp.nextPage, {
      forceFallback: Boolean(cp.pageFallback) && Boolean(cp.nextPage?.trim()),
    });
    logWalmartPagePlan(category.id, cp.nextPage, plan);
    const pageParams = {
      request: "paginated/items",
      categoryId: category?.id ?? null,
      nextPage: cp.nextPage,
      path: plan.path,
      fallback: plan.fallback,
    };
    try {
      const charged = await spendCall(gate, () => options.client.page(plan.path), () => {
        calls += 1;
      }, stampPace);
      if (charged === "budget") {
        paused = "budget";
        await persist("paused", { lastError: "Walmart daily budget reached" });
        break;
      }
      const payload = charged;
      const records = recordsFromWalmartPage(payload, category);
      const saved = await upsertCatalogRecords(records, nowFn());
      upserted += saved.offers;
      const next = walmartNextCursor(payload);
      noteWalmartSuccess(cp);
      cp.pageFallback = false;
      if (next && next !== cp.nextPage) {
        cp.nextPage = next;
      } else {
        skipWalmartCategory(cp);
      }
      if (cp.index >= cp.categories.length) {
        cp.phase = "done";
        await persist("completed", { finished: true, clearError: true });
        break;
      }
      await persist("running", { clearError: true });
    } catch (error) {
      if (isWalmartEndpointMiss(error) && !plan.fallback) {
        cp.pageFallback = true;
        console.warn(
          `Walmart pagination: category ${category.id} rejected the nextPage link (${error instanceof Error ? error.message : String(error)}). Next attempt rebuilds /paginated/items from the category id and page cursor.`
        );
        await persist("running", { error: ingestErrorDetail("walmart", error, pageParams, nowFn()) });
        continue;
      }
      const outcome = await failWalmart(cp, error, sleep, nowFn(), pageParams);
      cp = outcome.checkpoint;
      paused = outcome.paused;
      await persist(outcome.status, { error: outcome.error });
      if (outcome.stop) {
        break;
      }
    }
  }

  if (calls === 0 && !paused) {
    await persist(cp.phase === "done" ? "completed" : "idle");
  }
  return { provider: "walmart", calls, upserted, paused };
}

async function failWalmart(
  cp: WalmartCheckpoint,
  error: unknown,
  sleep: (ms: number) => Promise<void>,
  now: Date,
  params: Record<string, string | number | boolean | null | undefined>
): Promise<{ checkpoint: WalmartCheckpoint; paused: string | null; status: string; error: IngestErrorDetail; stop: boolean }> {
  const detail = ingestErrorDetail("walmart", error, params, now);
  const kind = retryClass(error);
  if (kind === "rate") {
    cp.rateStrikes += 1;
    cp.successStreak = 0;
    cp.attempts = cp.rateStrikes;
    cp.cooldownUntil = walmartCooldownUntil(now, cp.rateStrikes);
    return { checkpoint: cp, paused: "rate", status: "paused", error: detail, stop: true };
  }
  if (kind === "fatal") {
    if (params.request === "paginated/items") {
      console.warn(
        `Walmart pagination: skipping category ${String(params.categoryId ?? "")} after ${detail.message}`
      );
    }
    skipWalmartCategory(cp);
    return { checkpoint: cp, paused: null, status: "running", error: detail, stop: false };
  }
  cp.attempts += 1;
  if (cp.attempts >= MAX_ATTEMPTS) {
    if (params.request === "paginated/items") {
      console.warn(
        `Walmart pagination: skipping category ${String(params.categoryId ?? "")} after ${cp.attempts} failures (${detail.message})`
      );
    }
    skipWalmartCategory(cp);
    return { checkpoint: cp, paused: kind, status: "running", error: detail, stop: false };
  }
  await sleep(backoffDelayMs(cp.attempts));
  return { checkpoint: cp, paused: kind, status: "paused", error: detail, stop: true };
}

export async function noteShopperZip(zip: string | undefined): Promise<void> {
  const normalized = zip?.trim().slice(0, 5) ?? "";
  if (!/^\d{5}$/.test(normalized)) {
    return;
  }
  await ShopperZip.findOneAndUpdate(
    { zip: normalized },
    { $inc: { hits: 1 }, $set: { lastSeenAt: new Date() }, $setOnInsert: { zip: normalized } },
    { upsert: true }
  );
  await IngestCheckpoint.findOneAndUpdate(
    { provider: "kroger" },
    { $addToSet: { "checkpoint.pendingZips": normalized } },
    { upsert: true }
  );
}

async function trackedZips(config: IngestConfig): Promise<string[]> {
  const recent = await ShopperZip.find({ hits: { $gt: 0 } })
    .sort({ lastSeenAt: -1 })
    .limit(config.shopperZipLimit)
    .lean<Array<{ zip: string }>>();
  const zips = [...config.seedZips];
  for (const row of recent) {
    if (/^\d{5}$/.test(row.zip) && !zips.includes(row.zip)) {
      zips.push(row.zip);
    }
  }
  return zips.slice(0, config.seedZips.length + config.shopperZipLimit);
}

export async function stepKroger(options: {
  client: KrogerCatalogClient;
  maxCalls: number;
  store?: BudgetStore;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  config?: IngestConfig;
  /** Shelf stale ratio. Omit to count offers in Mongo. */
  staleRatio?: number;
}): Promise<SliceResult> {
  const config = options.config ?? ingestConfig();
  const nowFn = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const store = options.store ?? new MongoBudgetStore();
  const doc = await loadCheckpoint("kroger");
  let cp = asKroger(doc.checkpoint, nowFn());
  const productGate = gateFor(
    "kroger",
    config.krogerDailyBudget,
    config.krogerMinIntervalMs,
    store,
    () => nowFn().getTime(),
    sleep,
    epochMs(cp.nextAllowedAt)
  );
  const locationGate = gateFor(
    "kroger-locations",
    config.locationDailyBudget,
    config.krogerMinIntervalMs,
    store,
    () => nowFn().getTime(),
    sleep
  );
  if (cp.termsVersion !== KROGER_TERMS_VERSION) {
    cp.termsVersion = KROGER_TERMS_VERSION;
    cp.queryIndex = 0;
    cp.start = 0;
    cp.pageIndex = 0;
    delete cp.splitBrand;
    cp.brandSplits = [];
    cp.seenBrands = [];
  }
  const queries = krogerQueries();
  let calls = 0;
  let upserted = 0;
  let paused: string | null = null;
  let countedCalls = 0;
  let countedUpserts = 0;
  const split = await tickSplitFor("kroger", options.maxCalls, config, options.staleRatio);
  const lookupBudget = split.lookup;
  const refreshBudget = split.refresh;
  const refreshFirst = split.refreshFirst;
  let lookupsDone = 0;
  let lookupExhausted = false;
  let refreshesDone = 0;
  let refreshExhausted = false;

  const persist = async (status: string, extra?: PersistExtra) => {
    const callDelta = calls - countedCalls;
    const upsertDelta = upserted - countedUpserts;
    countedCalls = calls;
    countedUpserts = upserted;
    await saveCheckpoint("kroger", cp, {
      status,
      calls: callDelta,
      upserted: upsertDelta,
      ...(extra?.error ? { error: extra.error } : {}),
      ...(extra?.clearError ? { lastError: "" } : {}),
      ...(extra?.lastError !== undefined ? { lastError: extra.lastError } : {}),
      ...(extra?.finished ? { finished: true } : {}),
      ...(extra?.cycle ? { cycle: true } : {}),
    });
  };

  const stampProductPace = () => {
    const nextAt = productGate.nextAllowedAt();
    if (nextAt > 0) {
      cp.nextAllowedAt = new Date(nextAt).toISOString();
    }
  };

  async function markKrogerLookupMiss(pick: LookupPick): Promise<void> {
    const finished = await finishLookups("kroger", [pick], nowFn(), { forceMiss: true });
    cp.matchAttempts += finished.attempts;
    cp.attempts = 0;
    delete cp.termFallback;
    await persist("running", { clearError: true });
  }

  /** Name search after filter.productId was rejected or empty. A 400 stays a miss. */
  async function runKrogerTerm(pending: KrogerTermFallback): Promise<"done" | "stop"> {
    const term = sanitizeKrogerParam(pending.name, 80);
    const lookupTerm = options.client.lookupTerm;
    if (!term || !lookupTerm || calls >= options.maxCalls) {
      if (!term || !lookupTerm) {
        await markKrogerLookupMiss(lookupPickFromTerm(pending));
        return "done";
      }
      cp.termFallback = pending;
      await persist("running", { clearError: true });
      return "stop";
    }
    try {
      const charged = await spendCall(
        productGate,
        () => lookupTerm(term, pending.locationId),
        () => {
          calls += 1;
        },
        stampProductPace
      );
      if (charged === "budget") {
        cp.termFallback = pending;
        paused = "budget";
        await persist("paused", { lastError: "Kroger daily budget reached" });
        return "stop";
      }
      const matched = bindKrogerLookupRecords(charged.records, pending, "term");
      if (matched.length > 0) {
        const saved = await upsertCatalogRecords(matched, nowFn());
        upserted += saved.offers;
        const finished = await finishLookups("kroger", [lookupPickFromTerm(pending)], nowFn());
        cp.matchAttempts += finished.attempts;
        cp.matchHits += finished.hits;
      } else {
        const finished = await finishLookups("kroger", [lookupPickFromTerm(pending)], nowFn(), { forceMiss: true });
        cp.matchAttempts += finished.attempts;
      }
      cp.attempts = 0;
      delete cp.termFallback;
      await persist("running", { clearError: true });
      return "done";
    } catch (error) {
      if (krogerClientMiss(error)) {
        await markKrogerLookupMiss(lookupPickFromTerm(pending));
        return "done";
      }
      const kind = retryClass(error);
      if (kind === "fatal" || cp.attempts >= 2) {
        await markKrogerLookupMiss(lookupPickFromTerm(pending));
        return "done";
      }
      cp.termFallback = pending;
      const outcome = await failKroger(cp, error, sleep, nowFn(), { request: "products", term, lookup: true });
      cp = outcome.checkpoint;
      cp.termFallback = pending;
      paused = outcome.paused;
      await persist(outcome.status, { error: outcome.error });
      return outcome.stop ? "stop" : "done";
    }
  }

  while (calls < options.maxCalls) {
    if (cp.termFallback && options.client.lookupProductId) {
      const outcome = await runKrogerTerm(cp.termFallback);
      if (outcome === "stop") {
        break;
      }
      continue;
    }
    const turn = nextTickTurn({
      refreshFirst,
      lookupPending: Boolean(options.client.lookupProductId) && !lookupExhausted,
      refreshPending: Boolean(options.client.lookupProductId) && !refreshExhausted,
      lookupsDone,
      lookupBudget,
      refreshesDone,
      refreshBudget,
    });
    if (turn === "lookup") {
      const [picked] = await nextKrogerLookups(nowFn(), 1);
      if (!picked) {
        lookupExhausted = true;
        continue;
      } else {
        const locationId = cp.locations[cp.locationIndex]?.locationId || cp.locations[0]?.locationId;
        const pending: KrogerTermFallback = {
          key: picked.key,
          name: picked.name,
          code: picked.code,
          ...(picked.upc ? { upc: picked.upc } : {}),
          ...(locationId ? { locationId } : {}),
        };
        lookupsDone += 1;
        try {
          const charged = await spendCall(
            productGate,
            () => options.client.lookupProductId!(picked.code, locationId),
            () => {
              calls += 1;
            },
            stampProductPace
          );
          if (charged === "budget") {
            paused = "budget";
            await persist("paused", { lastError: "Kroger daily budget reached" });
            break;
          }
          const bound = bindKrogerLookupRecords(charged.records, picked, "id");
          if (bound.length === 0) {
            const outcome = await runKrogerTerm(pending);
            if (outcome === "stop") {
              break;
            }
          } else {
            const saved = await upsertCatalogRecords(bound, nowFn());
            upserted += saved.offers;
            const finished = await finishLookups("kroger", [picked], nowFn());
            cp.matchAttempts += finished.attempts;
            cp.matchHits += finished.hits;
            cp.attempts = 0;
            delete cp.termFallback;
            await persist("running", { clearError: true });
          }
        } catch (error) {
          const kind = retryClass(error);
          if (krogerClientMiss(error)) {
            const outcome = await runKrogerTerm(pending);
            if (outcome === "stop") {
              break;
            }
          } else if (kind === "fatal" || cp.attempts >= 2) {
            const finished = await finishLookups("kroger", [picked], nowFn(), { forceMiss: true });
            cp.matchAttempts += finished.attempts;
            cp.attempts = 0;
            await persist("running", {
              error: ingestErrorDetail("kroger", error, { request: "products", productId: picked.code }, nowFn()),
            });
          } else {
            const outcome = await failKroger(cp, error, sleep, nowFn(), {
              request: "products",
              productId: picked.code,
            });
            cp = outcome.checkpoint;
            paused = outcome.paused;
            await persist(outcome.status, { error: outcome.error });
            if (outcome.stop) {
              break;
            }
          }
        }
        continue;
      }
    }
    if (turn === "refresh") {
      const [picked] = await nextRefreshPicks("Kroger", nowFn(), 1);
      if (!picked) {
        refreshExhausted = true;
        continue;
      } else {
        const locationId = picked.locationId || cp.locations[cp.locationIndex]?.locationId || cp.locations[0]?.locationId;
        refreshesDone += 1;
        try {
          const charged = await spendCall(
            productGate,
            () => options.client.lookupProductId!(picked.code, locationId),
            () => {
              calls += 1;
            },
            () => {
              const nextAt = productGate.nextAllowedAt();
              if (nextAt > 0) {
                cp.nextAllowedAt = new Date(nextAt).toISOString();
              }
            }
          );
          if (charged === "budget") {
            paused = "budget";
            await persist("paused", { lastError: "Kroger daily budget reached" });
            break;
          }
          let refreshed = 0;
          if (charged.records.length > 0) {
            const saved = await upsertCatalogRecords(charged.records, nowFn());
            upserted += saved.offers;
            refreshed = saved.offers;
          }
          await finishRefresh([picked], nowFn(), refreshed);
          cp.attempts = 0;
          await persist("running", { clearError: true });
        } catch (error) {
          const kind = retryClass(error);
          if (krogerClientMiss(error)) {
            await finishRefresh([picked], nowFn(), 0);
            cp.attempts = 0;
            await persist("running", { clearError: true });
          } else if (kind === "fatal" || cp.attempts >= 2) {
            await finishRefresh([picked], nowFn(), 0);
            cp.attempts = 0;
            await persist("running", {
              error: ingestErrorDetail("kroger", error, { request: "products", productId: picked.code, refresh: true }, nowFn()),
            });
          } else {
            const outcome = await failKroger(cp, error, sleep, nowFn(), {
              request: "products",
              productId: picked.code,
              refresh: true,
            });
            cp = outcome.checkpoint;
            paused = outcome.paused;
            await persist(outcome.status, { error: outcome.error });
            if (outcome.stop) {
              break;
            }
          }
        }
        continue;
      }
    }
    if (cp.phase === "done" && refreshDue(cp.cycleStartedAt, config.refreshHours, nowFn())) {
      const pending = cp.pendingZips;
      cp = { ...emptyKroger(nowFn()), pendingZips: pending, phase: "locations", termFallback: cp.termFallback };
    }

    if (cp.pendingZips.length > 0) {
      const zip = cp.pendingZips[0];
      if (!cp.locations.some((location) => location.zip === zip)) {
        try {
          const charged = await spendCall(locationGate, () => options.client.resolveLocation(zip), () => {
            calls += 1;
          }, () => undefined);
          if (charged === "budget") {
            paused = "budget";
            await persist("paused", { lastError: "Kroger location budget reached" });
            break;
          }
          const locationId = charged;
          cp.pendingZips = cp.pendingZips.filter((item) => item !== zip);
          if (locationId) {
            cp.locations.splice(cp.locationIndex, 0, { zip, locationId });
            cp.queryIndex = 0;
            cp.start = 0;
            cp.pageIndex = 0;
            delete cp.splitBrand;
            cp.brandSplits = [];
            cp.seenBrands = [];
            await ShopperZip.updateOne({ zip }, { $set: { locationId } });
          }
          await persist("running", { clearError: true });
        } catch (error) {
          const outcome = await failKroger(cp, error, sleep, nowFn(), { request: "locations", zip });
          cp = outcome.checkpoint;
          paused = outcome.paused;
          await persist(outcome.status, { error: outcome.error });
          if (outcome.stop) {
            break;
          }
        }
        continue;
      }
      cp.pendingZips = cp.pendingZips.filter((item) => item !== zip);
    }

    if (cp.phase === "locations") {
      if (cp.plannedZips.length === 0) {
        cp.plannedZips = await trackedZips(config);
        cp.zipCursor = 0;
        cp.locations = [];
        cp.cycleStartedAt = nowFn().toISOString();
      }
      if (cp.zipCursor >= cp.plannedZips.length) {
        cp.phase = cp.locations.length === 0 ? "done" : "queries";
        cp.locationIndex = 0;
        cp.queryIndex = 0;
        cp.start = 0;
        cp.pageIndex = 0;
        await persist(cp.phase === "done" ? "completed" : "running", {
          ...(cp.phase === "done" ? { finished: true } : {}),
          cycle: true,
        });
        if (cp.phase === "done") {
          break;
        }
        continue;
      }
      const zip = cp.plannedZips[cp.zipCursor];
      try {
        const charged = await spendCall(locationGate, () => options.client.resolveLocation(zip), () => {
          calls += 1;
        }, () => undefined);
        if (charged === "budget") {
          paused = "budget";
          await persist("paused", { lastError: "Kroger location budget reached" });
          break;
        }
        const locationId = charged;
        if (locationId && !cp.locations.some((location) => location.locationId === locationId)) {
          cp.locations.push({ zip, locationId });
        }
        cp.zipCursor += 1;
        cp.attempts = 0;
        await persist("running", { clearError: true });
      } catch (error) {
        const detail = ingestErrorDetail("kroger", error, { request: "locations", zip }, nowFn());
        const kind = retryClass(error);
        if (kind === "fatal" || cp.attempts + 1 >= MAX_ATTEMPTS) {
          cp.zipCursor += 1;
          cp.attempts = 0;
          await persist("running", { error: detail });
          continue;
        }
        cp.attempts += 1;
        await sleep(backoffDelayMs(cp.attempts));
        paused = kind;
        await persist("paused", { error: detail });
        break;
      }
      continue;
    }

    if (cp.phase === "done" || cp.locationIndex >= cp.locations.length) {
      cp.phase = "done";
      await persist("completed", { finished: true });
      break;
    }

    const location = cp.locations[cp.locationIndex];
    const query = queries[cp.queryIndex];
    if (!query) {
      cp.locationIndex += 1;
      cp.queryIndex = 0;
      cp.start = 0;
      cp.pageIndex = 0;
      delete cp.splitBrand;
      cp.brandSplits = [];
      cp.seenBrands = [];
      if (cp.locationIndex >= cp.locations.length) {
        cp.phase = "done";
        await persist("completed", { finished: true });
        break;
      }
      await persist("running");
      continue;
    }

    const term = sanitizeKrogerParam(query.term.term, 80);
    const splitBrand = cp.splitBrand ? sanitizeKrogerParam(cp.splitBrand, 40) : null;
    const brand = splitBrand ?? (query.brand ? sanitizeKrogerParam(query.brand, 40) : null);
    if (!term || (query.brand && !brand)) {
      const detail = ingestErrorDetail(
        "kroger",
        new Error("Kroger filter skipped (empty or invalid term or brand)"),
        {
          term: query.term.term,
          brand: query.brand ?? null,
          start: cp.start,
          limit: config.krogerPageLimit,
          locationId: location.locationId,
          zip: location.zip,
        },
        nowFn()
      );
      skipKrogerQuery(cp);
      await persist("running", { error: detail });
      continue;
    }

    const requestParams = {
      term,
      brand,
      start: cp.start,
      limit: config.krogerPageLimit,
      locationId: location.locationId,
      zip: location.zip,
    };
    if (krogerStartParam(cp.start).action === "too-high") {
      const opened = !cp.splitBrand && !query.brand && beginKrogerBrandSplit(cp, query.term.brands);
      const continued = !opened && continueKrogerBrandSplit(cp);
      if (!opened && !continued) {
        skipKrogerQuery(cp);
      }
      await persist("running");
      continue;
    }
    try {
      const charged = await spendCall(
        productGate,
        () =>
          options.client.page({
            term,
            locationId: location.locationId,
            start: cp.start,
            limit: config.krogerPageLimit,
            ...(brand ? { brand } : {}),
            departmentId: query.term.departmentId,
            subcategory: query.term.subcategory,
            zip: location.zip,
          }),
        () => {
          calls += 1;
        },
        () => {
          const nextAt = productGate.nextAllowedAt();
          if (nextAt > 0) {
            cp.nextAllowedAt = new Date(nextAt).toISOString();
          }
        }
      );
      if (charged === "budget") {
        paused = "budget";
        await persist("paused", { lastError: "Kroger daily budget reached" });
        break;
      }
      const page = charged;
      const saved = await upsertCatalogRecords(page.records, nowFn());
      upserted += saved.offers;
      if (!brand) {
        rememberKrogerBrands(cp, page.records);
      }
      const advance = krogerAdvance(
        cp.start,
        config.krogerPageLimit,
        page.returned,
        cp.pageIndex,
        config.krogerMaxPagesPerTerm
      );
      cp.attempts = 0;
      cp.clientErrorStreak = 0;
      if (advance.kind === "page" && advance.start !== null) {
        cp.start = advance.start;
        cp.pageIndex += 1;
      } else if (advance.kind === "start-ceiling" && !cp.splitBrand && !query.brand && beginKrogerBrandSplit(cp, query.term.brands)) {
        // Broad term filled the 1..250 window. Keep going by brand instead of start=300.
      } else if (cp.splitBrand && continueKrogerBrandSplit(cp)) {
        // This brand is done. The next queued brand starts at the first page.
      } else {
        skipKrogerQuery(cp);
      }
      await persist("running", { clearError: true });
    } catch (error) {
      const status = httpStatusOf(error);
      if (status !== null && status >= 400 && status < 500 && status !== 429) {
        const detail = ingestErrorDetail("kroger", error, requestParams, nowFn());
        const skipped = noteKrogerClientError(cp, location.locationId);
        if (skipped === "location" && cp.locationIndex >= cp.locations.length) {
          cp.phase = "done";
        }
        detail.params.action = skipped === "location" ? "skipped-location" : "skipped-term";
        await persist(cp.phase === "done" ? "completed" : "running", {
          error: detail,
          ...(cp.phase === "done" ? { finished: true } : {}),
        });
        continue;
      }
      const outcome = await failKroger(cp, error, sleep, nowFn(), requestParams);
      cp = outcome.checkpoint;
      paused = outcome.paused;
      await persist(outcome.status, { error: outcome.error });
      if (outcome.stop) {
        break;
      }
    }
  }

  return { provider: "kroger", calls, upserted, paused };
}

function rememberKrogerBrands(cp: KrogerCheckpoint, records: Array<{ brand?: string }>): void {
  const next = [...(cp.seenBrands ?? [])];
  for (const record of records) {
    const brand = sanitizeKrogerParam(record.brand, 40);
    if (!brand || next.some((item) => item.toLowerCase() === brand.toLowerCase())) {
      continue;
    }
    next.push(brand);
    if (next.length >= 24) {
      break;
    }
  }
  cp.seenBrands = next;
}

function beginKrogerBrandSplit(cp: KrogerCheckpoint, skip: string[] | undefined): boolean {
  const splits = pickBrandSplits(cp.seenBrands, skip);
  cp.seenBrands = [];
  if (splits.length === 0) {
    return false;
  }
  cp.splitBrand = splits[0];
  cp.brandSplits = splits.slice(1);
  cp.start = 0;
  cp.pageIndex = 0;
  return true;
}

function continueKrogerBrandSplit(cp: KrogerCheckpoint): boolean {
  const next = cp.brandSplits?.[0];
  if (!next) {
    return false;
  }
  cp.brandSplits = cp.brandSplits?.slice(1) ?? [];
  cp.splitBrand = next;
  cp.start = 0;
  cp.pageIndex = 0;
  cp.seenBrands = [];
  return true;
}

function skipKrogerQuery(cp: KrogerCheckpoint): void {
  cp.queryIndex += 1;
  cp.start = 0;
  cp.pageIndex = 0;
  cp.attempts = 0;
  delete cp.splitBrand;
  cp.brandSplits = [];
  cp.seenBrands = [];
  if (cp.queryIndex < 0) {
    cp.queryIndex = 0;
  }
}

/** A 400 does not retry the same page. Three in a row on one location skip that store. */
function noteKrogerClientError(cp: KrogerCheckpoint, locationId: string): "query" | "location" {
  if (cp.clientErrorLocationId === locationId) {
    cp.clientErrorStreak += 1;
  } else {
    cp.clientErrorLocationId = locationId;
    cp.clientErrorStreak = 1;
  }
  if (cp.clientErrorStreak >= KROGER_LOCATION_ERROR_LIMIT) {
    cp.locationIndex += 1;
    cp.queryIndex = 0;
    cp.start = 0;
    cp.pageIndex = 0;
    cp.attempts = 0;
    cp.clientErrorStreak = 0;
    delete cp.splitBrand;
    cp.brandSplits = [];
    cp.seenBrands = [];
    return "location";
  }
  skipKrogerQuery(cp);
  return "query";
}

async function failKroger(
  cp: KrogerCheckpoint,
  error: unknown,
  sleep: (ms: number) => Promise<void>,
  now: Date,
  params: Record<string, string | number | boolean | null | undefined>
): Promise<{ checkpoint: KrogerCheckpoint; paused: string | null; status: string; error: IngestErrorDetail; stop: boolean }> {
  const detail = ingestErrorDetail("kroger", error, params, now);
  const kind = retryClass(error);
  if (kind === "fatal" || cp.attempts + 1 >= MAX_ATTEMPTS) {
    skipKrogerQuery(cp);
    return { checkpoint: cp, paused: kind === "fatal" ? null : kind, status: "running", error: detail, stop: false };
  }
  cp.attempts += 1;
  await sleep(backoffDelayMs(cp.attempts));
  return { checkpoint: cp, paused: kind, status: "paused", error: detail, stop: true };
}

export async function runDemoIngest(now = new Date()): Promise<SliceResult> {
  const saved = await upsertCatalogRecords(demoRecords(), now);
  await saveCheckpoint(
    "demo",
    { phase: "done", cycleStartedAt: now.toISOString() },
    { status: "completed", calls: 0, upserted: saved.offers, finished: true, cycle: true }
  );
  await markStaleCatalog(now);
  await scanPriceDropAlerts(now);
  return { provider: "demo", calls: 0, upserted: saved.offers, paused: null };
}

export async function acquireIngestLock(owner = randomUUID()): Promise<string | null> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_MS);
  const existing = await IngestLock.findOneAndUpdate(
    { _id: LOCK_ID, expiresAt: { $lte: now } },
    { $set: { owner, expiresAt } },
    { new: true }
  ).lean<{ owner?: string } | null>();
  if (existing?.owner === owner) {
    return owner;
  }
  try {
    await IngestLock.create({ _id: LOCK_ID, owner, expiresAt });
    return owner;
  } catch {
    return null;
  }
}

export async function releaseIngestLock(owner: string): Promise<void> {
  await IngestLock.updateOne({ _id: LOCK_ID, owner }, { $set: { expiresAt: new Date(0) } });
}

export async function runIngestTick(options?: {
  maxCalls?: number;
  walmart?: WalmartCatalogClient;
  kroger?: KrogerCatalogClient;
  store?: BudgetStore;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  force?: boolean;
}): Promise<{ locked: boolean; slices: SliceResult[] }> {
  const config = ingestConfig();
  if (!config.enabled && !options?.force) {
    return { locked: false, slices: [] };
  }
  const owner = await acquireIngestLock();
  if (!owner) {
    return { locked: false, slices: [] };
  }
  const slices: SliceResult[] = [];
  try {
    const maxCalls = options?.maxCalls ?? config.batchCalls;
    const walmartReady = config.walmartEnabled && walmartPricingProvider.isConfigured();
    const krogerReady = config.krogerEnabled && krogerApiConfigured();
    if (!walmartReady && !krogerReady) {
      const done = await IngestCheckpoint.findOne({ provider: "demo", status: "completed" }).lean();
      if (!done) {
        slices.push(await runDemoIngest(options?.now?.() ?? new Date()));
      } else {
        await scanPriceDropAlerts(options?.now?.() ?? new Date());
      }
      return { locked: true, slices };
    }
    let remaining = maxCalls;
    if (walmartReady && remaining > 0) {
      const slice = await stepWalmart({
        client: options?.walmart ?? walmartAffiliateClient(),
        maxCalls: remaining,
        store: options?.store,
        now: options?.now,
        sleep: options?.sleep,
        config,
      });
      slices.push(slice);
      remaining -= slice.calls;
    }
    if (krogerReady && remaining > 0) {
      slices.push(
        await stepKroger({
          client: options?.kroger ?? krogerProductsClient(),
          maxCalls: remaining,
          store: options?.store,
          now: options?.now,
          sleep: options?.sleep,
          config,
        })
      );
    }
    await markStaleCatalog(options?.now?.() ?? new Date());
    await scanPriceDropAlerts(options?.now?.() ?? new Date());
    return { locked: true, slices };
  } finally {
    await releaseIngestLock(owner);
  }
}
