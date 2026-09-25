import { randomUUID } from "node:crypto";
import { demoRecords } from "../catalog/demoCatalog";
import { krogerApiConfigured } from "../pricing/krogerProvider";
import { walmartPricingProvider } from "../pricing/walmartProvider";
import {
  backoffDelayMs,
  MongoBudgetStore,
  RateGate,
  retryClass,
  type BudgetStore,
} from "./budget";
import { krogerProductsClient, walmartAffiliateClient, type KrogerCatalogClient, type WalmartCatalogClient } from "./clients";
import { ingestConfig, type IngestConfig } from "./config";
import { KROGER_TERMS_VERSION, krogerQueries, nextKrogerStart } from "./krogerTerms";
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
const LOCK_MS = 90_000;
const MAX_ATTEMPTS = 5;

export type WalmartCheckpoint = {
  phase: "taxonomy" | "categories" | "done";
  categories: WalmartCategory[];
  index: number;
  nextPage: string | null;
  attempts: number;
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
  cycleStartedAt: string;
};

type CheckpointDoc = {
  provider: string;
  status?: string;
  checkpoint?: unknown;
  recentErrors?: string[];
  calls?: number;
  upserted?: number;
  cycles?: number;
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
    cycleStartedAt: now.toISOString(),
  };
}

function asWalmart(value: unknown, now: Date): WalmartCheckpoint {
  const record = value && typeof value === "object" ? (value as Partial<WalmartCheckpoint>) : {};
  return {
    ...emptyWalmart(now),
    ...record,
    categories: Array.isArray(record.categories) ? record.categories : [],
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
  };
}

async function loadCheckpoint(provider: string): Promise<CheckpointDoc> {
  const doc = await IngestCheckpoint.findOne({ provider }).lean<CheckpointDoc | null>();
  return doc ?? { provider, checkpoint: {}, recentErrors: [], calls: 0, upserted: 0, cycles: 0 };
}

async function saveCheckpoint(
  provider: string,
  checkpoint: unknown,
  patch: { status: string; lastError?: string; error?: string; calls?: number; upserted?: number; finished?: boolean; cycle?: boolean }
): Promise<void> {
  const errors = patch.error ? [patch.error] : [];
  await IngestCheckpoint.findOneAndUpdate(
    { provider },
    {
      $set: {
        provider,
        checkpoint,
        status: patch.status,
        ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
        ...(patch.finished ? { lastFinishedAt: new Date() } : {}),
      },
      $inc: {
        ...(patch.calls ? { calls: patch.calls } : {}),
        ...(patch.upserted ? { upserted: patch.upserted } : {}),
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

async function gateFor(
  provider: string,
  budget: number,
  minIntervalMs: number,
  store: BudgetStore,
  now: () => number,
  sleep: (ms: number) => Promise<void>
): Promise<RateGate> {
  return new RateGate({ provider, dailyBudget: budget, minIntervalMs, store, now, sleep });
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
  const gate = await gateFor("walmart", config.walmartDailyBudget, config.walmartMinIntervalMs, store, () => nowFn().getTime(), sleep);
  const doc = await loadCheckpoint("walmart");
  let cp = asWalmart(doc.checkpoint, nowFn());
  let calls = 0;
  let upserted = 0;
  let paused: string | null = null;

  const persist = async (status: string, extra?: { error?: string; finished?: boolean; cycle?: boolean }) => {
    await saveCheckpoint("walmart", cp, {
      status,
      calls,
      upserted,
      ...(extra?.error ? { error: extra.error, lastError: extra.error } : { lastError: "" }),
      ...(extra?.finished ? { finished: true } : {}),
      ...(extra?.cycle ? { cycle: true } : {}),
    });
  };

  while (calls < options.maxCalls) {
    if (cp.phase === "done" && refreshDue(cp.cycleStartedAt, config.refreshHours, nowFn())) {
      cp = { ...emptyWalmart(nowFn()), phase: "categories", categories: cp.categories };
    }
    if (cp.phase === "taxonomy" || (cp.phase === "categories" && cp.categories.length === 0 && cp.index === 0)) {
      const slot = await gate.take();
      if (slot === "budget") {
        paused = "budget";
        break;
      }
      calls += 1;
      try {
        const taxonomy = await options.client.taxonomy();
        cp.categories = groceryLeaves(taxonomy);
        cp.phase = cp.categories.length === 0 ? "done" : "categories";
        cp.index = 0;
        cp.nextPage = null;
        cp.attempts = 0;
        if (cp.phase === "done") {
          await persist("completed", { finished: true, cycle: true });
          break;
        }
        await persist("running", { cycle: true });
      } catch (error) {
        const outcome = await failWalmart(cp, error, sleep);
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
    const slot = await gate.take();
    if (slot === "budget") {
      paused = "budget";
      break;
    }
    calls += 1;
    try {
      const payload = await options.client.page(path);
      const records = recordsFromWalmartPage(payload, category);
      const saved = await upsertCatalogRecords(records, nowFn());
      upserted += saved.offers;
      const next = walmartNextCursor(payload);
      cp.attempts = 0;
      if (next && next !== cp.nextPage) {
        cp.nextPage = next;
      } else {
        cp.index += 1;
        cp.nextPage = null;
      }
      if (cp.index >= cp.categories.length) {
        cp.phase = "done";
        await persist("completed", { finished: true });
        break;
      }
      await persist("running");
    } catch (error) {
      const outcome = await failWalmart(cp, error, sleep);
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
  sleep: (ms: number) => Promise<void>
): Promise<{ checkpoint: WalmartCheckpoint; paused: string | null; status: string; error: string; stop: boolean }> {
  const message = error instanceof Error ? error.message : String(error);
  const kind = retryClass(error);
  if (kind === "fatal") {
    cp.index += 1;
    cp.nextPage = null;
    cp.attempts = 0;
    return { checkpoint: cp, paused: null, status: "running", error: message, stop: false };
  }
  cp.attempts += 1;
  if (cp.attempts >= MAX_ATTEMPTS) {
    cp.index += 1;
    cp.nextPage = null;
    cp.attempts = 0;
    return { checkpoint: cp, paused: kind, status: "running", error: message, stop: false };
  }
  await sleep(backoffDelayMs(cp.attempts));
  return { checkpoint: cp, paused: kind, status: "paused", error: message, stop: true };
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
  const recent = await ShopperZip.find()
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
  const productGate = await gateFor(
    "kroger",
    config.krogerDailyBudget,
    config.krogerMinIntervalMs,
    store,
    () => nowFn().getTime(),
    sleep
  );
  const locationGate = await gateFor(
    "kroger-locations",
    config.locationDailyBudget,
    config.krogerMinIntervalMs,
    store,
    () => nowFn().getTime(),
    sleep
  );
  const doc = await loadCheckpoint("kroger");
  let cp = asKroger(doc.checkpoint, nowFn());
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

  const persist = async (status: string, extra?: { error?: string; finished?: boolean; cycle?: boolean }) => {
    await saveCheckpoint("kroger", cp, {
      status,
      calls,
      upserted,
      ...(extra?.error ? { error: extra.error, lastError: extra.error } : {}),
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
        const slot = await locationGate.take();
        if (slot === "budget") {
          paused = "budget";
          break;
        }
        calls += 1;
        try {
          const locationId = await options.client.resolveLocation(zip);
          cp.pendingZips = cp.pendingZips.filter((item) => item !== zip);
          if (locationId) {
            cp.locations.splice(cp.locationIndex, 0, { zip, locationId });
            cp.queryIndex = 0;
            cp.start = 0;
            cp.pageIndex = 0;
            await ShopperZip.updateOne({ zip }, { $set: { locationId } });
          }
          await persist("running");
        } catch (error) {
          const outcome = await failKroger(cp, error, sleep);
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
      const slot = await locationGate.take();
      if (slot === "budget") {
        paused = "budget";
        break;
      }
      calls += 1;
      try {
        const locationId = await options.client.resolveLocation(zip);
        if (locationId && !cp.locations.some((location) => location.locationId === locationId)) {
          cp.locations.push({ zip, locationId });
        }
        await ShopperZip.updateOne(
          { zip },
          { $set: { ...(locationId ? { locationId } : {}), lastSeenAt: nowFn() }, $setOnInsert: { hits: 0, zip } },
          { upsert: true }
        );
        cp.zipCursor += 1;
        cp.attempts = 0;
        await persist("running");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const kind = retryClass(error);
        if (kind === "fatal" || cp.attempts + 1 >= MAX_ATTEMPTS) {
          cp.zipCursor += 1;
          cp.attempts = 0;
          await persist("running", { error: message });
          continue;
        }
        cp.attempts += 1;
        await sleep(backoffDelayMs(cp.attempts));
        paused = kind;
        await persist("paused", { error: message });
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

    const slot = await productGate.take();
    if (slot === "budget") {
      paused = "budget";
      break;
    }
    calls += 1;
    try {
      const page = await options.client.page({
        term: query.term.term,
        locationId: location.locationId,
        start: cp.start,
        limit: config.krogerPageLimit,
        brand: query.brand,
        departmentId: query.term.departmentId,
        subcategory: query.term.subcategory,
        zip: location.zip,
      });
      const saved = await upsertCatalogRecords(page.records, nowFn());
      upserted += saved.offers;
      const next = nextKrogerStart(cp.start, config.krogerPageLimit, page.returned, cp.pageIndex, config.krogerMaxPagesPerTerm);
      cp.attempts = 0;
      if (next === null) {
        cp.queryIndex += 1;
        cp.start = 0;
        cp.pageIndex = 0;
      } else {
        cp.start = next;
        cp.pageIndex += 1;
      }
      await persist("running");
    } catch (error) {
      const outcome = await failKroger(cp, error, sleep);
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

async function failKroger(
  cp: KrogerCheckpoint,
  error: unknown,
  sleep: (ms: number) => Promise<void>
): Promise<{ checkpoint: KrogerCheckpoint; paused: string | null; status: string; error: string; stop: boolean }> {
  const message = error instanceof Error ? error.message : String(error);
  const kind = retryClass(error);
  if (kind === "fatal" || cp.attempts + 1 >= MAX_ATTEMPTS) {
    cp.queryIndex += 1;
    cp.start = 0;
    cp.pageIndex = 0;
    cp.attempts = 0;
    return { checkpoint: cp, paused: kind === "fatal" ? null : kind, status: "running", error: message, stop: false };
  }
  cp.attempts += 1;
  await sleep(backoffDelayMs(cp.attempts));
  return { checkpoint: cp, paused: kind, status: "paused", error: message, stop: true };
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
