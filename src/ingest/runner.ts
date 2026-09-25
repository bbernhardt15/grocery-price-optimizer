import { randomUUID } from "node:crypto";
import { demoRecords } from "../catalog/demoCatalog";
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
  walmartCooldownUntil,
  type BudgetStore,
  type IngestErrorDetail,
} from "./budget";
import { krogerProductsClient, walmartAffiliateClient, type KrogerCatalogClient, type WalmartCatalogClient } from "./clients";
import { ingestConfig, type IngestConfig } from "./config";
import { KROGER_TERMS_VERSION, krogerQueries, nextKrogerStart, sanitizeKrogerParam } from "./krogerTerms";
import { IngestCheckpoint, IngestLock, ShopperZip } from "./models";
import { markStaleCatalog, upsertCatalogRecords } from "./upsert";
import {
  groceryLeaves,
  recordsFromWalmartPage,
  walmartNextCursor,
  walmartPagePath,
  type WalmartCategory,
} from "./walmartWalk";

const LOCK_ID = "catalog-ingest";
const LOCK_MS = 180_000;
const MAX_ATTEMPTS = 5;
const KROGER_LOCATION_ERROR_LIMIT = 3;

export type WalmartCheckpoint = {
  phase: "taxonomy" | "categories" | "done";
  categories: WalmartCategory[];
  index: number;
  nextPage: string | null;
  attempts: number;
  rateStrikes: number;
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
  pendingZips: string[];
  clientErrorStreak: number;
  clientErrorLocationId?: string;
  nextAllowedAt?: string;
  cycleStartedAt: string;
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
    categories: [],
    index: 0,
    nextPage: null,
    attempts: 0,
    rateStrikes: 0,
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

export async function stepWalmart(options: {
  client: WalmartCatalogClient;
  maxCalls: number;
  store?: BudgetStore;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  config?: IngestConfig;
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
        cp.attempts = 0;
        cp.rateStrikes = 0;
        delete cp.cooldownUntil;
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
    const path = walmartPagePath(category.id, cp.nextPage);
    try {
      const charged = await spendCall(gate, () => options.client.page(path), () => {
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
      cp.attempts = 0;
      cp.rateStrikes = 0;
      delete cp.cooldownUntil;
      if (next && next !== cp.nextPage) {
        cp.nextPage = next;
      } else {
        cp.index += 1;
        cp.nextPage = null;
      }
      if (cp.index >= cp.categories.length) {
        cp.phase = "done";
        await persist("completed", { finished: true, clearError: true });
        break;
      }
      await persist("running", { clearError: true });
    } catch (error) {
      const outcome = await failWalmart(cp, error, sleep, nowFn(), {
        request: "paginated/items",
        categoryId: category?.id ?? null,
        nextPage: cp.nextPage,
      });
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
    cp.attempts = cp.rateStrikes;
    cp.cooldownUntil = walmartCooldownUntil(now, cp.rateStrikes);
    return { checkpoint: cp, paused: "rate", status: "paused", error: detail, stop: true };
  }
  if (kind === "fatal") {
    cp.index += 1;
    cp.nextPage = null;
    cp.attempts = 0;
    return { checkpoint: cp, paused: null, status: "running", error: detail, stop: false };
  }
  cp.attempts += 1;
  if (cp.attempts >= MAX_ATTEMPTS) {
    cp.index += 1;
    cp.nextPage = null;
    cp.attempts = 0;
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
  }
  const queries = krogerQueries();
  let calls = 0;
  let upserted = 0;
  let paused: string | null = null;
  let countedCalls = 0;
  let countedUpserts = 0;

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

  while (calls < options.maxCalls) {
    if (cp.phase === "done" && refreshDue(cp.cycleStartedAt, config.refreshHours, nowFn())) {
      const pending = cp.pendingZips;
      cp = { ...emptyKroger(nowFn()), pendingZips: pending, phase: "locations" };
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
      if (cp.locationIndex >= cp.locations.length) {
        cp.phase = "done";
        await persist("completed", { finished: true });
        break;
      }
      await persist("running");
      continue;
    }

    const term = sanitizeKrogerParam(query.term.term, 80);
    const brand = query.brand ? sanitizeKrogerParam(query.brand, 40) : null;
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
      const next = nextKrogerStart(cp.start, config.krogerPageLimit, page.returned, cp.pageIndex, config.krogerMaxPagesPerTerm);
      cp.attempts = 0;
      cp.clientErrorStreak = 0;
      if (next === null) {
        cp.queryIndex += 1;
        cp.start = 0;
        cp.pageIndex = 0;
      } else {
        cp.start = next;
        cp.pageIndex += 1;
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

function skipKrogerQuery(cp: KrogerCheckpoint): void {
  cp.queryIndex += 1;
  cp.start = 0;
  cp.pageIndex = 0;
  cp.attempts = 0;
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
    return { locked: true, slices };
  } finally {
    await releaseIngestLock(owner);
  }
}
