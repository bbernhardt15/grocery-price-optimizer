import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { browseCatalog } from "../catalog/service";
import { krogerProductIdForLookup, upcKey, walmartLookupCodes, walmartUpcForLookup } from "../catalog/normalize";
import type { RawCatalogRecord } from "../catalog/types";
import { MemoryBudgetStore, MongoBudgetStore, utcDay } from "./budget";
import { ingestConfig } from "./config";
import { KROGER_TERMS_VERSION } from "./krogerTerms";
import { dropShadowLocalKeys, excludeNongroceryFromRefresh, recategorizeCatalog, resetRunCounters, startRecategorizeJob } from "./maintenance";
import { CatalogDemand, CatalogMaster, CatalogOffer, CatalogRefreshDay, IngestBudget, IngestCheckpoint, IngestLock, ShopperZip } from "./models";
import { SharedList } from "../models/SharedList";
import { noteCatalogDemand } from "./demand";
import { krogerLookupBlock, matchProgress, nextKrogerLookups, nextWalmartLookups } from "./crossLookup";
import { acquireIngestLock, noteShopperZip, releaseIngestLock, runDemoIngest, stepKroger, stepWalmart } from "./runner";
import { catalogFamilySample, catalogMatchQueue, catalogMatchSample, catalogOtherBreakdown, catalogSample, catalogStatus, catalogSuspicious } from "./status";
import { nextRefreshPicks } from "./refresh";
import { markStaleCatalog, upsertCatalogRecords } from "./upsert";
import { recordsFromWalmartPage } from "./walmartWalk";

const milk = (store: string, upc: string, price: number, locationId?: string): RawCatalogRecord => ({
  name: "Whole Milk",
  brand: "Dairy Pure",
  storeName: store,
  price,
  upc,
  size: "1 gal",
  priceSource: "live",
  departmentId: "dairy-eggs",
  ...(locationId ? { locationId } : {}),
});

describe("catalog ingestion", () => {
  let memory: MongoMemoryServer;
  const previous = {
    CATALOG_DB_FIRST: process.env.CATALOG_DB_FIRST,
    CATALOG_INGEST_ENABLED: process.env.CATALOG_INGEST_ENABLED,
    CATALOG_MAX_PRODUCTS: process.env.CATALOG_MAX_PRODUCTS,
    CATALOG_MAX_OFFERS: process.env.CATALOG_MAX_OFFERS,
    CATALOG_STALE_DAYS: process.env.CATALOG_STALE_DAYS,
    CATALOG_DISCONTINUE_DAYS: process.env.CATALOG_DISCONTINUE_DAYS,
    CATALOG_SEED_ZIPS: process.env.CATALOG_SEED_ZIPS,
    ADMIN_TOKEN: process.env.ADMIN_TOKEN,
    WALMART_INGEST_MIN_INTERVAL_MS: process.env.WALMART_INGEST_MIN_INTERVAL_MS,
    KROGER_INGEST_MIN_INTERVAL_MS: process.env.KROGER_INGEST_MIN_INTERVAL_MS,
  };

  before(async () => {
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    await memory.stop();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("merges Walmart and Kroger offers that share a UPC", async () => {
    const saved = await upsertCatalogRecords([
      milk("Walmart", "00011122233348", 3.18),
      milk("Kroger", "011122233348", 3.29, "01400999"),
    ]);
    assert.equal(saved.offers, 2);
    const masters = await CatalogMaster.find({ key: upcKey("00011122233348") });
    assert.equal(masters.length, 1);
    const offers = await CatalogOffer.find({ productKey: masters[0]?.key });
    assert.equal(offers.length, 2);
    assert.deepEqual(
      offers.map((offer) => offer.storeName).sort(),
      ["Kroger", "Walmart"]
    );
  });

  it("refuses new products once the cap is reached and still refreshes an existing one", async () => {
    process.env.CATALOG_MAX_PRODUCTS = "1";
    const key = upcKey("00011122233348");
    await CatalogMaster.deleteMany({ key: { $ne: key } });
    await CatalogOffer.deleteMany({ productKey: { $ne: key } });
    const blocked = await upsertCatalogRecords([
      {
        name: "Cheddar",
        brand: "Kroger",
        storeName: "Kroger",
        price: 2.5,
        upc: "00099988877766",
        priceSource: "live",
        departmentId: "dairy-eggs",
      },
    ]);
    assert.equal(blocked.skippedByCap, 1);
    assert.equal(await CatalogMaster.countDocuments({ key: upcKey("00099988877766") }), 0);
    const refreshed = await upsertCatalogRecords([milk("Walmart", "00011122233348", 2.99)]);
    assert.equal(refreshed.offers, 1);
    const offer = await CatalogOffer.findOne({ productKey: key, storeName: "Walmart" });
    assert.equal(offer?.price, 2.99);
    delete process.env.CATALOG_MAX_PRODUCTS;
  });

  it("marks offers stale and then discontinued from lastSeenAt", async () => {
    process.env.CATALOG_STALE_DAYS = "14";
    process.env.CATALOG_DISCONTINUE_DAYS = "45";
    const key = upcKey("00011122233348");
    const staleAt = new Date(Date.now() - 20 * 86_400_000);
    await CatalogOffer.updateMany({ productKey: key }, { $set: { lastSeenAt: staleAt, status: "active" } });
    await CatalogMaster.updateMany({ key }, { $set: { lastSeenAt: staleAt, status: "active" } });
    const stale = await markStaleCatalog(new Date());
    assert.ok(stale.stale >= 1);
    assert.equal((await CatalogOffer.findOne({ productKey: key }))?.status, "stale");
    const goneAt = new Date(Date.now() - 50 * 86_400_000);
    await CatalogOffer.updateMany({ productKey: key }, { $set: { lastSeenAt: goneAt } });
    await markStaleCatalog(new Date());
    assert.equal((await CatalogOffer.findOne({ productKey: key }))?.status, "discontinued");
    delete process.env.CATALOG_STALE_DAYS;
    delete process.env.CATALOG_DISCONTINUE_DAYS;
  });

  it("keeps one master when Walmart and two Kroger locations share a UPC", async () => {
    const [walmart] = recordsFromWalmartPage({
      items: [
        {
          itemId: 4242,
          name: "Whole Milk",
          brandName: "Dairy Pure",
          salePrice: 3.1,
          upc: 22233344455,
          size: "1 gal",
        },
      ],
    });
    assert.ok(walmart);
    const saved = await upsertCatalogRecords([
      walmart,
      milk("Kroger", "00022233344455", 3.4, "01400001"),
      milk("Kroger", "022233344455", 3.55, "01400002"),
    ]);
    assert.equal(saved.offers, 3);
    const key = upcKey("22233344455");
    assert.equal(await CatalogMaster.countDocuments({ key }), 1);
    const offers = await CatalogOffer.find({ productKey: key });
    assert.equal(offers.length, 3);
    await upsertCatalogRecords([walmart]);
    assert.equal(await CatalogOffer.countDocuments({ productKey: key }), 3);
    assert.deepEqual(
      offers.map((offer) => `${offer.storeName}:${offer.locationId}`).sort(),
      ["Kroger:01400001", "Kroger:01400002", "Walmart:"]
    );
  });

  it("does not merge a Walmart row that has no UPC with a Kroger UPC", async () => {
    const [walmart] = recordsFromWalmartPage({
      items: [{ itemId: 77, name: "Mystery Cereal", brandName: "Great Value", salePrice: 2.4 }],
    });
    assert.equal(walmart?.upc, undefined);
    await upsertCatalogRecords([
      walmart!,
      {
        name: "Mystery Cereal",
        brand: "Great Value",
        storeName: "Kroger",
        price: 2.5,
        upc: "00088877766655",
        priceSource: "live",
        locationId: "01400009",
      },
    ]);
    assert.equal(await CatalogMaster.countDocuments({ key: "local:walmart:77" }), 1);
    assert.equal(await CatalogMaster.countDocuments({ key: upcKey("00088877766655") }), 1);
    assert.equal(await CatalogOffer.countDocuments({ productKey: "local:walmart:77" }), 1);
  });

  it("resumes the Walmart crawl on the saved nextPage and does not advance on 429", async () => {
    await IngestCheckpoint.deleteMany({ provider: "walmart" });
    const pages = [
      {
        items: [
          {
            itemId: 111,
            name: "Whole Milk",
            brandName: "Dairy Pure",
            salePrice: 3.18,
            upc: "00055566677788",
            size: "1 gal",
          },
        ],
        nextPage: "cursor-2",
        nextPageExist: true,
      },
      {
        items: [
          {
            itemId: 222,
            name: "Large Eggs",
            brandName: "Great Value",
            salePrice: 2.22,
            upc: "00055566677795",
            size: "12 ct",
          },
        ],
        nextPageExist: false,
      },
    ];
    let pageCalls = 0;
    const client = {
      taxonomy: async () => ({
        categories: [
          { id: "milk", name: "Milk", path: "Food/Dairy/Milk", children: [] },
          { id: "tv", name: "TVs", path: "Electronics/TVs", children: [] },
        ],
      }),
      page: async (path: string) => {
        pageCalls += 1;
        if (pageCalls === 2) {
          const error = new Error("slow");
          (error as Error & { status: number }).status = 429;
          throw error;
        }
        return path.includes("nextPage") ? pages[1] : pages[0];
      },
    };
    const config = ingestConfig();
    config.walmartDailyBudget = 20;
    config.walmartMinIntervalMs = 0;
    const store = new MemoryBudgetStore();
    let clock = Date.parse("2026-09-25T18:40:00.000Z");
    const now = () => new Date(clock);
    const sleep = async (ms: number) => {
      clock += ms;
    };
    const first = await stepWalmart({ client, maxCalls: 2, store, sleep, config, now });
    assert.equal(first.calls, 2);
    const saved = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{
      calls?: number;
      checkpoint?: { nextPage?: string; index?: number };
    }>();
    assert.equal(saved?.checkpoint?.nextPage, "cursor-2");
    assert.equal(saved?.calls, 2);
    assert.equal(await store.used("walmart", now()), 2);
    const callsBefore429 = pageCalls;
    const blocked = await stepWalmart({ client, maxCalls: 1, store, sleep, config, now });
    assert.equal(blocked.paused, "rate");
    assert.equal(blocked.calls, 1);
    const held = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{
      calls?: number;
      recentErrors?: Array<{ provider?: string; status?: number; params?: { categoryId?: string } }>;
      checkpoint?: { nextPage?: string; index?: number; cooldownUntil?: string; rateStrikes?: number };
    }>();
    assert.equal(held?.checkpoint?.nextPage, "cursor-2");
    assert.equal(held?.checkpoint?.index, 0);
    assert.equal(held?.checkpoint?.rateStrikes, 1);
    assert.equal(held?.calls, 3);
    assert.ok(held?.checkpoint?.cooldownUntil);
    assert.ok(Date.parse(held.checkpoint.cooldownUntil) > clock);
    assert.equal(held?.recentErrors?.at(-1)?.status, 429);
    assert.equal(held?.recentErrors?.at(-1)?.provider, "walmart");
    assert.equal(held?.recentErrors?.at(-1)?.params?.categoryId, "milk");
    const during = await stepWalmart({ client, maxCalls: 1, store, sleep, config, now });
    assert.equal(during.paused, "cooldown");
    assert.equal(during.calls, 0);
    assert.equal(pageCalls, callsBefore429 + 1);
    clock = Date.parse(held.checkpoint.cooldownUntil) + 1000;
    await stepWalmart({ client, maxCalls: 1, store, sleep, config, now });
    assert.equal(await CatalogMaster.countDocuments({ key: upcKey("00055566677795") }), 1);
    assert.equal(await CatalogMaster.countDocuments({ upc: /55566677788/ }), 1);
    const resumed = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{ calls?: number }>();
    assert.equal(resumed?.calls, 4);
  });

  it("waits out the Walmart pace saved on the previous tick", async () => {
    await IngestCheckpoint.deleteMany({ provider: "walmart" });
    let clock = 1_000_000;
    const sleeps: number[] = [];
    const config = ingestConfig();
    config.walmartDailyBudget = 20;
    config.walmartMinIntervalMs = 5000;
    const client = {
      taxonomy: async () => ({ categories: [{ id: "milk", name: "Milk", path: "Food/Dairy/Milk", children: [] }] }),
      page: async () => ({ items: [], nextPageExist: false }),
    };
    const now = () => new Date(clock);
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    };
    await stepWalmart({ client, maxCalls: 1, store: new MemoryBudgetStore(), sleep, config, now });
    await stepWalmart({ client, maxCalls: 1, store: new MemoryBudgetStore(), sleep, config, now });
    assert.ok(sleeps.some((ms) => ms >= 5000));
  });

  it("refuses Walmart calls once the daily ledger reaches the cap", async () => {
    await IngestBudget.deleteMany({ provider: "walmart-cap" });
    await IngestBudget.createIndexes();
    const store = new MongoBudgetStore();
    const now = new Date("2026-09-25T12:00:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 12 }, () => store.tryConsume("walmart-cap", 5, now))
    );
    assert.equal(results.filter(Boolean).length, 5);
    assert.equal(await store.used("walmart-cap", now), 5);
    assert.equal(await store.tryConsume("walmart-cap", 5, now), false);
  });

  it("resumes Kroger filter.start for the same term and location", async () => {
    await IngestCheckpoint.deleteMany({ provider: "kroger" });
    process.env.CATALOG_SEED_ZIPS = "45103";
    const seen: Array<{ start: number; term: string }> = [];
    const config = ingestConfig();
    config.krogerDailyBudget = 20;
    config.locationDailyBudget = 10;
    config.krogerMinIntervalMs = 0;
    config.krogerPageLimit = 50;
    config.krogerMaxPagesPerTerm = 4;
    config.seedZips = ["45103"];
    const client = {
      resolveLocation: async () => "01400999",
      page: async (query: { start: number; term: string; locationId?: string; zip?: string }) => {
        seen.push({ start: query.start, term: query.term });
        assert.equal(query.locationId, "01400999");
        assert.equal(query.zip, "45103");
        if (query.start === 0) {
          return {
            returned: 50,
            records: [milk("Kroger", "00044455566677", 3.4, "01400999")],
          };
        }
        return {
          returned: 3,
          records: [milk("Kroger", "00044455566684", 2.1, "01400999")],
        };
      },
    };
    await stepKroger({ client, maxCalls: 1, store: new MemoryBudgetStore(), sleep: async () => undefined, config });
    const mid = await IngestCheckpoint.findOne({ provider: "kroger" }).lean<{ checkpoint?: { phase?: string; zipCursor?: number } }>();
    assert.equal(mid?.checkpoint?.phase, "locations");
    await stepKroger({ client, maxCalls: 2, store: new MemoryBudgetStore(), sleep: async () => undefined, config });
    assert.deepEqual(seen.map((row) => row.start), [0, 50]);
    assert.equal(seen[0]?.term, seen[1]?.term);
    assert.equal(await ShopperZip.countDocuments({ zip: "45103" }), 0);
    const counted = await IngestCheckpoint.findOne({ provider: "kroger" }).lean<{ calls?: number }>();
    assert.equal(counted?.calls, 3);
    delete process.env.CATALOG_SEED_ZIPS;
  });

  it("stops paging a Kroger term on 400 and logs the request params", async () => {
    await IngestCheckpoint.deleteMany({ provider: "kroger" });
    await ShopperZip.deleteMany({ zip: "45103" });
    const seen: Array<{ start: number; term: string }> = [];
    await IngestCheckpoint.create({
      provider: "kroger",
      status: "running",
      calls: 0,
      upserted: 0,
      checkpoint: {
        termsVersion: KROGER_TERMS_VERSION,
        phase: "queries",
        plannedZips: ["45103"],
        zipCursor: 1,
        locations: [{ zip: "45103", locationId: "01400999" }],
        locationIndex: 0,
        queryIndex: 0,
        start: 50,
        pageIndex: 1,
        attempts: 0,
        pendingZips: [],
        clientErrorStreak: 0,
        cycleStartedAt: "2026-09-25T18:00:00.000Z",
      },
    });
    const config = ingestConfig();
    config.krogerDailyBudget = 20;
    config.krogerMinIntervalMs = 0;
    config.krogerPageLimit = 50;
    let calls = 0;
    const client = {
      resolveLocation: async () => {
        throw new Error("location lookup should not run");
      },
      page: async (query: { start: number; term: string; locationId?: string }) => {
        calls += 1;
        seen.push({ start: query.start, term: query.term });
        if (calls <= 3) {
          const error = new Error("Kroger products request failed (400)");
          (error as Error & { status: number; body: string }).status = 400;
          (error as Error & { body: string }).body =
            '{"code":"invalidFilter","reason":"filter.start out of range"}';
          throw error;
        }
        return { returned: 1, records: [] };
      },
    };
    const slice = await stepKroger({
      client,
      maxCalls: 4,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => new Date("2026-09-25T18:30:00.000Z"),
    });
    assert.equal(slice.paused, null);
    assert.equal(seen.filter((row) => row.start === 50).length, 1);
    assert.ok(seen.slice(1).every((row) => row.start === 0));
    assert.equal(new Set(seen.map((row) => row.term)).size, seen.length);
    const saved = await IngestCheckpoint.findOne({ provider: "kroger" }).lean<{
      status?: string;
      lastError?: string;
      recentErrors?: Array<{
        provider?: string;
        status?: number;
        body?: string;
        params?: { term?: string; start?: number; locationId?: string; action?: string };
      }>;
      checkpoint?: { locationIndex?: number; phase?: string };
    }>();
    const logged = saved?.recentErrors?.find((entry) => entry.status === 400);
    assert.equal(logged?.provider, "kroger");
    assert.equal(logged?.params?.term, "bananas");
    assert.equal(logged?.params?.start, 50);
    assert.equal(logged?.params?.locationId, "01400999");
    assert.match(logged?.body ?? "", /filter\.start/);
    assert.ok(logged?.params?.action === "skipped-term" || logged?.params?.action === "skipped-location");
    assert.equal(saved?.checkpoint?.phase === "done" || (saved?.checkpoint?.locationIndex ?? 0) > 0, true);
    assert.match(saved?.lastError ?? "", /400/);
    assert.equal(await ShopperZip.countDocuments({ zip: "45103" }), 0);
  });

  it("reads browse from the database and keeps demo stores that were not ingested", async () => {
    process.env.CATALOG_DB_FIRST = "true";
    const page = await browseCatalog({ departmentId: "dairy-eggs", sort: "price", limit: 48 });
    assert.equal(page.catalogSource, "database");
    assert.ok(page.items.some((item) => item.upc?.includes("11122233348") || item.name === "Whole Milk"));
    const stores = new Set(page.items.flatMap((item) => item.offers.map((offer) => offer.storeName)));
    assert.ok(stores.has("Aldi"));
    assert.equal(page.items[0] && page.items[1] ? page.items[0].bestOffer.price <= page.items[1].bestOffer.price : true, true);
    delete process.env.CATALOG_DB_FIRST;
  });

  it("loads the demo provider into Mongo", async () => {
    const result = await runDemoIngest();
    assert.ok(result.upserted > 10);
    const demo = await IngestCheckpoint.findOne({ provider: "demo" });
    assert.equal(demo?.status, "completed");
  });

  it("protects the admin status route with ADMIN_TOKEN", async () => {
    delete process.env.ADMIN_TOKEN;
    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const missing = await fetch(`${origin}/api/admin/catalog/status`);
    assert.equal(missing.status, 503);
    process.env.ADMIN_TOKEN = "secret-token";
    const denied = await fetch(`${origin}/api/admin/catalog/status`, { headers: { authorization: "Bearer no" } });
    assert.equal(denied.status, 401);
    const ok = await fetch(`${origin}/api/admin/catalog/status`, { headers: { authorization: "Bearer secret-token" } });
    assert.equal(ok.status, 200);
    delete process.env.WALMART_INGEST_MIN_INTERVAL_MS;
    delete process.env.WALMART_INGEST_DAILY_BUDGET;
    delete process.env.CATALOG_MAX_PRODUCTS;
    delete process.env.CATALOG_MAX_OFFERS;
    const body = (await ok.json()) as {
      counts: {
        products: number;
        masters: { localWalmart: number; krogerOnly: number; walmartUpc: number; merged: number };
      };
      caps: { maxProducts: number; maxOffers: number };
      budget: { walmart: { limit: number; minIntervalMs: number } };
      shopperZips: Array<{ zip: string; hits: number }>;
      seedZips: string[];
    };
    assert.ok(body.counts.products > 0);
    assert.equal(body.caps.maxProducts, 150_000);
    assert.equal(body.caps.maxOffers, 500_000);
    assert.equal(body.budget.walmart.limit, 500);
    assert.equal(body.budget.walmart.minIntervalMs, 10_000);
    assert.equal(typeof body.counts.masters.localWalmart, "number");
    assert.equal(
      body.counts.masters.krogerOnly + body.counts.masters.walmartUpc + body.counts.masters.merged >= 0,
      true
    );
    const unconfirmed = await fetch(`${origin}/api/admin/catalog/reset-run-counters`, {
      method: "POST",
      headers: { authorization: "Bearer secret-token", "content-type": "application/json" },
      body: JSON.stringify({ confirm: "no" }),
    });
    assert.equal(unconfirmed.status, 400);
    const unauthenticated = await fetch(`${origin}/api/admin/catalog/drop-shadow-local-keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "drop-shadow-local-keys" }),
    });
    assert.equal(unauthenticated.status, 401);
    const queueDenied = await fetch(`${origin}/api/admin/catalog/match-queue`);
    assert.equal(queueDenied.status, 401);
    const queue = await fetch(`${origin}/api/admin/catalog/match-queue`, {
      headers: { authorization: "Bearer secret-token" },
    });
    assert.equal(queue.status, 200);
    const queueBody = (await queue.json()) as { dryRun: boolean; queue: { walmart: number; kroger: number }; hitRate: { walmart: number | null } };
    assert.equal(queueBody.dryRun, true);
    assert.equal(typeof queueBody.queue.walmart, "number");
    assert.equal(typeof queueBody.queue.kroger, "number");
    assert.equal(queueBody.hitRate.walmart === null || typeof queueBody.hitRate.walmart === "number", true);
    const suspiciousDenied = await fetch(`${origin}/api/admin/catalog/suspicious`);
    assert.equal(suspiciousDenied.status, 401);
    const suspiciousOk = await fetch(`${origin}/api/admin/catalog/suspicious?limit=5`, {
      headers: { authorization: "Bearer secret-token" },
    });
    assert.equal(suspiciousOk.status, 200);
    const suspiciousBody = (await suspiciousOk.json()) as {
      suspicious: number;
      departments: Array<{ id: string; name: string; suspicious: number }>;
      items: unknown[];
    };
    assert.equal(typeof suspiciousBody.suspicious, "number");
    assert.ok(suspiciousBody.departments.some((row) => row.id === "dairy-eggs" && row.name === "Dairy & Eggs"));
    assert.equal(suspiciousBody.departments.some((row) => row.id === "other"), false);
    assert.ok(Array.isArray(suspiciousBody.items));
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    delete process.env.ADMIN_TOKEN;
  });

  it("lets only one owner hold the ingest lock", async () => {
    await IngestLock.deleteMany({});
    const first = await acquireIngestLock("owner-a");
    const second = await acquireIngestLock("owner-b");
    assert.equal(first, "owner-a");
    assert.equal(second, null);
    await releaseIngestLock("owner-a");
    const third = await acquireIngestLock("owner-b");
    assert.equal(third, "owner-b");
    await releaseIngestLock("owner-b");
  });

  it("lists real shopper ZIPs apart from seed ZIPs", async () => {
    await ShopperZip.deleteMany({});
    await ShopperZip.create({ zip: "45103", hits: 0, lastSeenAt: new Date(), locationId: "01400001" });
    await noteShopperZip("45202");
    const status = await catalogStatus();
    assert.ok(status.seedZips.includes("45103"));
    assert.ok(status.shopperZips.some((row) => row.zip === "45202" && row.hits >= 1));
    assert.equal(
      status.shopperZips.some((row) => row.zip === "45103"),
      false
    );
  });

  it("resets run counters and drops only local keys that already have a UPC sibling", async () => {
    await IngestCheckpoint.findOneAndUpdate(
      { provider: "walmart" },
      { $set: { provider: "walmart", calls: 99, upserted: 99, status: "paused", "checkpoint.nextPage": "keep-me" } },
      { upsert: true }
    );
    await CatalogMaster.deleteMany({ key: { $in: ["local:walmart:4242", "local:walmart:555"] } });
    await CatalogOffer.deleteMany({ productKey: { $in: ["local:walmart:4242", "local:walmart:555"] } });
    const sibling = upcKey("22233344455");
    await CatalogMaster.updateOne({ key: sibling }, { $set: { walmartItemId: "4242" } });
    await CatalogMaster.create({
      key: "local:walmart:4242",
      name: "Whole Milk",
      brand: "Dairy Pure",
      departmentId: "dairy-eggs",
      walmartItemId: "4242",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: "local:walmart:4242",
      storeName: "Walmart",
      locationId: "",
      price: 3.1,
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogMaster.create({
      key: "local:walmart:555",
      name: "No Barcode Chips",
      brand: "Great Value",
      departmentId: "snacks",
      walmartItemId: "555",
      lastSeenAt: new Date(),
      status: "active",
    });
    const refused = await resetRunCounters();
    assert.ok(refused.providers.includes("walmart"));
    const cleared = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{ calls?: number; upserted?: number; checkpoint?: { nextPage?: string } }>();
    assert.equal(cleared?.calls, 0);
    assert.equal(cleared?.upserted, 0);
    assert.equal(cleared?.checkpoint?.nextPage, "keep-me");
    const dropped = await dropShadowLocalKeys();
    assert.equal(dropped.masters, 1);
    assert.equal(dropped.offers, 1);
    assert.equal(await CatalogMaster.countDocuments({ key: "local:walmart:4242" }), 0);
    assert.equal(await CatalogMaster.countDocuments({ key: "local:walmart:555" }), 1);
    assert.equal(await CatalogMaster.countDocuments({ key: sibling }), 1);
  });

  it("recategorizes a pantry row from its stored category path", async () => {
    await CatalogMaster.create({
      key: "local:walmart:cereal-path",
      name: "Corn Flakes",
      brand: "Great Value",
      departmentId: "pantry",
      categoryPaths: ["Food/Breakfast Foods/Cereal"],
      lastSeenAt: new Date(),
      status: "active",
    });
    const result = await recategorizeCatalog();
    assert.ok(result.examined > 0);
    assert.ok(result.updated >= 1);
    const row = await CatalogMaster.findOne({ key: "local:walmart:cereal-path" });
    assert.equal(row?.departmentId, "breakfast");
    const krogerKey = upcKey("00032100000017");
    await CatalogMaster.create({
      key: krogerKey,
      name: "Ice Pops",
      brand: "Kroger",
      departmentId: "pantry",
      subcategory: "Canned",
      categoryPaths: ["Frozen"],
      krogerProductId: "00032100000017",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogMaster.create({
      key: "upc-canned-staple",
      name: "Diced Tomatoes",
      brand: "Kroger",
      departmentId: "other",
      categoryPaths: ["Canned & Packaged"],
      krogerProductId: "00032100000024",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogMaster.create({
      key: "upc-pantry-path",
      name: "Toasted Flakes",
      brand: "Great Value",
      departmentId: "pantry",
      categoryPaths: ["Food/Breakfast Foods/Cereal", "Food/Pantry"],
      walmartItemId: "9001",
      lastSeenAt: new Date(),
      status: "active",
    });
    const again = await recategorizeCatalog();
    assert.ok(again.updated >= 2);
    assert.equal((await CatalogMaster.findOne({ key: krogerKey }))?.departmentId, "frozen");
    assert.equal((await CatalogMaster.findOne({ key: krogerKey }))?.subcategory, undefined);
    assert.equal((await CatalogMaster.findOne({ key: "upc-canned-staple" }))?.departmentId, "pantry");
    assert.equal((await CatalogMaster.findOne({ key: "upc-pantry-path" }))?.departmentId, "breakfast");
    await CatalogMaster.create({
      key: "keep-widget",
      name: "Widget",
      brand: "Acme",
      departmentId: "snacks",
      categoryPaths: ["Miscellaneous"],
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogMaster.create({
      key: "stroller-row",
      name: "Graco Modes",
      brand: "Graco",
      departmentId: "baby",
      categoryPaths: ["Baby/Strollers/Full-Size"],
      walmartItemId: "stroller-1",
      lastSeenAt: new Date(),
      status: "active",
    });
    await recategorizeCatalog();
    assert.equal((await CatalogMaster.findOne({ key: "keep-widget" }))?.departmentId, "other");
    assert.equal((await CatalogMaster.findOne({ key: "stroller-row" }))?.departmentId, "other");
    await CatalogMaster.create({
      key: "wipe-warmer-row",
      name: "Wipe Warmer",
      brand: "Munchkin",
      departmentId: "baby",
      categoryPaths: ["Baby/Feeding"],
      walmartItemId: "warmer-1",
      lastSeenAt: new Date(),
      status: "active",
    });
    await recategorizeCatalog();
    assert.equal((await CatalogMaster.findOne({ key: "wipe-warmer-row" }))?.departmentId, "other");
    assert.equal(await CatalogMaster.countDocuments({ key: "wipe-warmer-row" }), 1);
    assert.equal(await CatalogMaster.countDocuments({ key: "stroller-row" }), 1);
  });

  it("upgrades a local Walmart key to the UPC in place when the catalog is full", async () => {
    await CatalogMaster.deleteMany({ key: { $in: ["local:walmart:77", "local:walmart:88"] } });
    await CatalogOffer.deleteMany({ productKey: { $in: ["local:walmart:77", "local:walmart:88"] } });
    await CatalogMaster.create({
      key: "local:walmart:77",
      name: "Mystery Cereal",
      brand: "Great Value",
      departmentId: "breakfast",
      walmartItemId: "77",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: "local:walmart:77",
      storeName: "Walmart",
      locationId: "",
      price: 2.4,
      lastSeenAt: new Date(),
      status: "active",
    });
    const before = await CatalogMaster.countDocuments();
    process.env.CATALOG_MAX_PRODUCTS = String(before);
    const [withUpc] = recordsFromWalmartPage({
      items: [{ itemId: 77, name: "Mystery Cereal", brandName: "Great Value", salePrice: 2.5, upc: "00066677788899" }],
    });
    const upgraded = await upsertCatalogRecords([withUpc!]);
    const upc = upcKey("00066677788899");
    assert.equal(upgraded.skippedByCap, 0);
    assert.equal(await CatalogMaster.countDocuments(), before);
    assert.equal(await CatalogMaster.countDocuments({ key: "local:walmart:77" }), 0);
    assert.equal(await CatalogMaster.countDocuments({ key: upc }), 1);
    assert.equal((await CatalogMaster.findOne({ key: upc }))?.walmartItemId, "77");
    assert.equal(await CatalogOffer.countDocuments({ productKey: upc, storeName: "Walmart" }), 1);
    assert.equal(await CatalogOffer.countDocuments({ productKey: "local:walmart:77" }), 0);
    const blocked = await upsertCatalogRecords([
      {
        name: "New Cheese",
        brand: "Kroger",
        storeName: "Kroger",
        price: 2.5,
        upc: "00099900011122",
        priceSource: "live",
      },
    ]);
    assert.equal(blocked.skippedByCap, 1);
    assert.equal(await CatalogMaster.countDocuments({ key: upcKey("00099900011122") }), 0);
    delete process.env.CATALOG_MAX_PRODUCTS;
  });

  it("keeps a Kroger search term when the only category label is Pantry", async () => {
    const saved = await upsertCatalogRecords([
      {
        name: "Purina ONE",
        brand: "Purina",
        storeName: "Kroger",
        price: 14.5,
        upc: "00017800123456",
        productId: "00017800123456",
        categories: ["Pantry"],
        departmentId: "pet",
        subcategory: "Dog",
        priceSource: "live",
      },
    ]);
    assert.equal(saved.skippedByCap, 0);
    const row = await CatalogMaster.findOne({ key: upcKey("00017800123456") });
    assert.equal(row?.departmentId, "pet");
    assert.equal(row?.subcategory, "Dog");
    assert.equal(row?.krogerProductId, "00017800123456");
  });

  it("stops a Kroger term at filter.start 250 and continues by brand", async () => {
    await IngestCheckpoint.deleteMany({ provider: "kroger" });
    await IngestCheckpoint.create({
      provider: "kroger",
      status: "running",
      calls: 0,
      checkpoint: {
        termsVersion: KROGER_TERMS_VERSION,
        phase: "queries",
        plannedZips: ["45255"],
        zipCursor: 1,
        locations: [{ zip: "45255", locationId: "01400431" }],
        locationIndex: 0,
        queryIndex: 0,
        start: 250,
        pageIndex: 5,
        attempts: 0,
        pendingZips: [],
        clientErrorStreak: 0,
        seenBrands: ["Dole"],
        cycleStartedAt: "2026-09-29T12:00:00.000Z",
      },
    });
    const seen: Array<{ start: number; term: string; brand?: string }> = [];
    const config = ingestConfig();
    config.krogerDailyBudget = 20;
    config.krogerMinIntervalMs = 0;
    config.krogerPageLimit = 50;
    config.krogerMaxPagesPerTerm = 8;
    const client = {
      resolveLocation: async () => "01400431",
      page: async (query: { start: number; term: string; brand?: string }) => {
        seen.push({ start: query.start, term: query.term, brand: query.brand });
        assert.ok(query.start <= 250);
        if (query.brand) {
          return { returned: 1, records: [] };
        }
        return {
          returned: 50,
          records: [
            {
              name: "Bananas",
              brand: "Chiquita",
              storeName: "Kroger",
              price: 0.6,
              upc: "00040110000018",
              priceSource: "live" as const,
            },
          ],
        };
      },
    };
    await stepKroger({
      client,
      maxCalls: 2,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => new Date("2026-09-29T13:00:00.000Z"),
    });
    assert.equal(seen[0]?.start, 250);
    assert.equal(seen[0]?.brand, undefined);
    assert.equal(seen[1]?.start, 0);
    assert.equal(seen[1]?.brand, "Dole");
    assert.equal(seen[0]?.term, seen[1]?.term);
    assert.equal(seen.some((row) => row.start > 250), false);
  });

  it("does not call Kroger when a saved start is already above 250", async () => {
    await IngestCheckpoint.deleteMany({ provider: "kroger" });
    await IngestCheckpoint.create({
      provider: "kroger",
      status: "running",
      calls: 0,
      checkpoint: {
        termsVersion: KROGER_TERMS_VERSION,
        phase: "queries",
        plannedZips: ["45255"],
        zipCursor: 1,
        locations: [{ zip: "45255", locationId: "01400431" }],
        locationIndex: 0,
        queryIndex: 0,
        start: 300,
        pageIndex: 6,
        attempts: 0,
        pendingZips: [],
        clientErrorStreak: 0,
        cycleStartedAt: "2026-09-29T12:00:00.000Z",
      },
    });
    const seen: number[] = [];
    const config = ingestConfig();
    config.krogerDailyBudget = 20;
    config.krogerMinIntervalMs = 0;
    const client = {
      resolveLocation: async () => "01400431",
      page: async (query: { start: number; term: string }) => {
        seen.push(query.start);
        assert.ok(query.start <= 250);
        return { returned: 1, records: [] };
      },
    };
    await stepKroger({
      client,
      maxCalls: 1,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => new Date("2026-09-29T13:00:00.000Z"),
    });
    assert.deepEqual(seen, [0]);
    assert.equal(seen.includes(300), false);
  });

  it("escalates consecutive Walmart 429s and stores the rate-limit headers", async () => {
    await IngestCheckpoint.deleteMany({ provider: "walmart" });
    const config = ingestConfig();
    config.walmartDailyBudget = 20;
    config.walmartMinIntervalMs = 0;
    let clock = Date.parse("2026-09-29T13:12:00.000Z");
    const now = () => new Date(clock);
    const sleep = async (ms: number) => {
      clock += ms;
    };
    let mode: "fail" | "ok" = "fail";
    const client = {
      taxonomy: async () => ({ categories: [{ id: "milk", name: "Milk", path: "Food/Dairy/Milk", children: [] }] }),
      page: async () => {
        if (mode === "ok") {
          return { items: [], nextPage: "cursor-ok", nextPageExist: true };
        }
        const error = new Error("Walmart Affiliate API failed (429)");
        (error as Error & { status: number; body: string; headers: Record<string, string> }).status = 429;
        (error as Error & { body: string }).body = '{"message":"rate limit"}';
        (error as Error & { headers: Record<string, string> }).headers = {
          "retry-after": "900",
          "x-ratelimit-remaining": "0",
          authorization: "Bearer secret",
        };
        throw error;
      },
    };
    const store = new MemoryBudgetStore();
    await stepWalmart({ client, maxCalls: 2, store, sleep, config, now });
    const firstHold = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{
      checkpoint?: { rateStrikes?: number; cooldownUntil?: string; index?: number };
      recentErrors?: Array<{ status?: number; body?: string; headers?: Record<string, string> }>;
    }>();
    assert.equal(firstHold?.checkpoint?.rateStrikes, 1);
    assert.equal(firstHold?.checkpoint?.index, 0);
    assert.equal(firstHold?.checkpoint?.cooldownUntil, "2026-09-29T13:27:00.000Z");
    assert.equal(firstHold?.recentErrors?.at(-1)?.headers?.["retry-after"], "900");
    assert.equal(firstHold?.recentErrors?.at(-1)?.headers?.authorization, undefined);
    assert.match(firstHold?.recentErrors?.at(-1)?.body ?? "", /rate limit/);
    clock = Date.parse(firstHold?.checkpoint?.cooldownUntil ?? "") + 1000;
    await stepWalmart({ client, maxCalls: 1, store, sleep, config, now });
    const second = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{
      checkpoint?: { rateStrikes?: number; cooldownUntil?: string };
    }>();
    assert.equal(second?.checkpoint?.rateStrikes, 2);
    assert.equal(second?.checkpoint?.cooldownUntil, new Date(clock + 30 * 60_000).toISOString());
    mode = "ok";
    clock = Date.parse(second?.checkpoint?.cooldownUntil ?? "") + 1000;
    await stepWalmart({ client, maxCalls: 1, store, sleep, config, now });
    const afterSuccess = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{
      checkpoint?: { rateStrikes?: number; successStreak?: number };
    }>();
    assert.equal(afterSuccess?.checkpoint?.rateStrikes, 2);
    assert.equal(afterSuccess?.checkpoint?.successStreak, 1);
    mode = "fail";
    await stepWalmart({ client, maxCalls: 1, store, sleep, config, now });
    const halted = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{
      checkpoint?: { rateStrikes?: number; cooldownUntil?: string; index?: number };
    }>();
    assert.equal(halted?.checkpoint?.rateStrikes, 3);
    assert.equal(halted?.checkpoint?.index, 0);
    assert.equal(halted?.checkpoint?.cooldownUntil, "2026-09-30T00:00:00.000Z");
  });

  it("samples a department at random and shows the mapping rule", async () => {
    await CatalogMaster.deleteMany({ departmentId: "baby" });
    await CatalogMaster.create({
      key: "baby-sample-carrots",
      name: "Baby Carrots",
      brand: "Bolthouse",
      departmentId: "baby",
      categoryPaths: ["Baby"],
      walmartItemId: "900",
      lastSeenAt: new Date(),
      status: "active",
    });
    const sample = await catalogSample("baby", 50);
    assert.ok(!("error" in sample));
    if ("error" in sample) {
      return;
    }
    assert.equal(sample.department, "baby");
    assert.equal(sample.n, 1);
    assert.equal(sample.items[0]?.name, "Baby Carrots");
    assert.equal(sample.items[0]?.stores, "walmart");
    assert.equal(sample.items[0]?.paths, "Baby");
    assert.equal(sample.items[0]?.stored, "baby");
    assert.equal(sample.items[0]?.now, "produce");
    assert.match(sample.items[0]?.rule ?? "", /produce/);
    const missing = await catalogSample("not-a-department", 10);
    assert.equal("error" in missing, true);
  });

  it("groups pack sizes into one family and keeps a different flavor separate", async () => {
    const rows: RawCatalogRecord[] = [
      {
        name: "Tilefam Cola 12 Pack 12 fl oz Cans",
        brand: "Tilefam",
        storeName: "Walmart",
        price: 7.48,
        upc: "0099998100901",
        size: "12 pk 12 fl oz",
        priceSource: "live",
        departmentId: "beverages",
      },
      {
        name: "Tilefam Cola 2 Liter Bottle",
        brand: "Tilefam",
        storeName: "Kroger",
        price: 2.48,
        upc: "0099998100918",
        size: "2 L",
        priceSource: "live",
        departmentId: "beverages",
      },
      {
        name: "Tilefam Diet Cola 12 Pack 12 fl oz Cans",
        brand: "Tilefam",
        storeName: "Walmart",
        price: 7.48,
        upc: "0099998100925",
        size: "12 pk 12 fl oz",
        priceSource: "live",
        departmentId: "beverages",
      },
    ];
    await upsertCatalogRecords(rows, new Date("2026-10-26T12:00:00.000Z"));
    const classic = await CatalogMaster.findOne({ upc: "0099998100901" }).lean<{ familyKey?: string; familyName?: string; variantLabel?: string } | null>();
    const bottle = await CatalogMaster.findOne({ upc: "0099998100918" }).lean<{ familyKey?: string; variantLabel?: string } | null>();
    const diet = await CatalogMaster.findOne({ upc: "0099998100925" }).lean<{ familyKey?: string } | null>();
    assert.ok(classic?.familyKey);
    assert.equal(classic?.familyKey, bottle?.familyKey);
    assert.notEqual(classic?.familyKey, diet?.familyKey);
    assert.match(classic?.variantLabel ?? "", /12 pk/);
    assert.match(bottle?.variantLabel ?? "", /2 L/);
    const sample = await catalogFamilySample({ query: "tilefam", department: "beverages", scan: 20, limit: 10 });
    assert.equal("error" in sample, false);
    if ("error" in sample) return;
    assert.equal(sample.families, 2);
    assert.equal(sample.groupedFamilies, 1);
    assert.equal(sample.groupedProducts, 2);
    assert.equal(sample.complete, true);
    const grouped = sample.groups.find((group) => group.count === 2);
    assert.ok(grouped);
    assert.equal(grouped?.variants.length, 2);
    const unknown = await catalogFamilySample({ department: "not-a-department" });
    assert.equal("error" in unknown, true);
  });

  it("shows normalized keys for Kroger-only, Walmart-only, and merged masters", async () => {
    const coke = "049000042566";
    const key = upcKey(coke);
    assert.ok(key);
    await CatalogMaster.deleteMany({
      key: { $not: /^local:/ },
      $or: [
        {
          krogerProductId: { $type: "string", $gt: "" },
          $or: [{ walmartItemId: { $exists: false } }, { walmartItemId: null }, { walmartItemId: "" }],
        },
        {
          walmartItemId: { $type: "string", $gt: "" },
          $or: [{ krogerProductId: { $exists: false } }, { krogerProductId: null }, { krogerProductId: "" }],
        },
      ],
    });
    await CatalogMaster.deleteMany({ key: { $in: [key, "kroger-only-sample", "walmart-only-sample"] } });
    await CatalogMaster.create({
      key: "kroger-only-sample",
      name: "Kroger Cola",
      brand: "Coca-Cola",
      departmentId: "beverages",
      upc: "0004900004256",
      krogerProductId: "0004900004256",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogMaster.create({
      key: "walmart-only-sample",
      name: "Walmart Cola",
      brand: "Coca-Cola",
      departmentId: "beverages",
      upc: coke,
      walmartItemId: "111",
      lastSeenAt: new Date(),
      status: "active",
    });
    const body = await catalogMatchSample();
    const kroger = body.krogerOnly.find((row) => row.name === "Kroger Cola");
    const walmart = body.walmartUpc.find((row) => row.name === "Walmart Cola");
    assert.ok(kroger);
    assert.ok(walmart);
    assert.equal(kroger?.krogerId, "0004900004256");
    assert.equal(kroger?.walmartUpc, coke);
    assert.equal(walmart?.walmartUpc, coke);
    assert.equal(walmart?.krogerId, kroger?.krogerId);
    assert.equal(upcKey(kroger?.upc), upcKey(walmart?.upc));
  });

  it("looks up a common Kroger-only UPC at Walmart and merges onto the same key", async () => {
    const krogerUpc = "0004900004256";
    const walmartUpc = walmartUpcForLookup(krogerUpc);
    const key = upcKey(krogerUpc);
    assert.equal(walmartUpc, "049000042566");
    assert.ok(key);
    await CatalogMaster.deleteMany({ key });
    await CatalogOffer.deleteMany({ productKey: key });
    await CatalogMaster.create({
      key,
      name: "Coca-Cola Classic",
      brand: "Coca-Cola",
      departmentId: "beverages",
      upc: krogerUpc,
      krogerProductId: krogerUpc,
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogMaster.create({
      key: "less-common-kroger",
      name: "Rare Soda",
      brand: "Store",
      departmentId: "beverages",
      upc: "0001111041700",
      krogerProductId: "0001111041700",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: key,
      storeName: "Kroger",
      locationId: "01400431",
      zip: "45255",
      price: 1.25,
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: key,
      storeName: "Kroger",
      locationId: "01400999",
      zip: "45202",
      price: 1.3,
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogMaster.updateMany(
      { key: { $nin: [key, "less-common-kroger"] } },
      { $set: { matchWalmartAt: new Date("2026-09-29T15:00:00.000Z"), matchWalmartVariant: 0 } }
    );
    const seen: string[] = [];
    const config = ingestConfig();
    config.walmartDailyBudget = 20;
    config.walmartMinIntervalMs = 0;
    config.walmartLookupBatch = 1;
    config.matchLookupShare = 1;
    const client = {
      taxonomy: async () => ({ categories: [] }),
      page: async () => ({ items: [] }),
      lookupUpc: async (upc: string) => {
        seen.push(upc);
        return {
          items: [
            {
              itemId: 4242,
              name: "Coca-Cola Classic",
              brandName: "Coca-Cola",
              salePrice: 1.18,
              upc: walmartUpc,
            },
          ],
        };
      },
    };
    await IngestCheckpoint.deleteMany({ provider: "walmart" });
    const slice = await stepWalmart({
      client,
      maxCalls: 1,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => new Date("2026-09-29T15:00:00.000Z"),
    });
    assert.equal(slice.calls, 1);
    assert.deepEqual(seen, [walmartUpc]);
    const row = await CatalogMaster.findOne({ key });
    assert.equal(row?.walmartItemId, "4242");
    assert.equal(row?.krogerProductId, krogerUpc);
    assert.ok(row?.matchWalmartAt);
    assert.equal(await CatalogMaster.countDocuments({ key }), 1);
    seen.length = 0;
    await stepWalmart({
      client,
      maxCalls: 1,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => new Date("2026-09-29T15:01:00.000Z"),
    });
    assert.deepEqual(seen, [walmartUpcForLookup("0001111041700")]);
    const again = await CatalogMaster.findOne({ key });
    assert.equal(again?.walmartItemId, "4242");
  });

  it("looks up a Walmart UPC at Kroger by productId and does not delete the master", async () => {
    const walmartUpc = "049000042566";
    const productId = krogerProductIdForLookup(walmartUpc);
    const key = upcKey(walmartUpc);
    assert.equal(productId, "0004900004256");
    assert.ok(key);
    await CatalogMaster.deleteMany({ key });
    await CatalogMaster.create({
      key,
      name: "Coca-Cola Classic",
      brand: "Coca-Cola",
      departmentId: "beverages",
      upc: walmartUpc,
      walmartItemId: "4242",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogMaster.updateMany(
      { key: { $ne: key } },
      { $set: { matchKrogerAt: new Date("2026-09-29T15:00:00.000Z"), matchKrogerVariant: 0 } }
    );
    const seen: Array<{ productId: string; locationId?: string }> = [];
    const config = ingestConfig();
    config.krogerDailyBudget = 20;
    config.krogerMinIntervalMs = 0;
    await IngestCheckpoint.deleteMany({ provider: "kroger" });
    await IngestCheckpoint.create({
      provider: "kroger",
      status: "running",
      checkpoint: {
        termsVersion: KROGER_TERMS_VERSION,
        phase: "queries",
        plannedZips: ["45255"],
        zipCursor: 1,
        locations: [{ zip: "45255", locationId: "01400431" }],
        locationIndex: 0,
        queryIndex: 0,
        start: 0,
        pageIndex: 0,
        attempts: 0,
        pendingZips: [],
        clientErrorStreak: 0,
        cycleStartedAt: "2026-09-29T15:00:00.000Z",
      },
    });
    const client = {
      resolveLocation: async () => "01400431",
      page: async () => {
        throw new Error("page should not run when the lookup uses the only call");
      },
      lookupProductId: async (id: string, locationId?: string) => {
        seen.push({ productId: id, locationId });
        return {
          returned: 1,
          records: [
            {
              name: "Coca-Cola Classic",
              brand: "Coca-Cola",
              storeName: "Kroger",
              price: 1.25,
              upc: productId ?? undefined,
              productId: productId ?? undefined,
              priceSource: "live" as const,
              locationId,
              categories: ["Beverages"],
            },
          ],
        };
      },
    };
    const slice = await stepKroger({
      client,
      maxCalls: 1,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => new Date("2026-09-29T15:00:00.000Z"),
    });
    assert.equal(slice.calls, 1);
    assert.deepEqual(seen, [{ productId, locationId: "01400431" }]);
    const row = await CatalogMaster.findOne({ key });
    assert.equal(row?.krogerProductId, productId);
    assert.equal(row?.walmartItemId, "4242");
    assert.equal(await CatalogMaster.countDocuments({ walmartItemId: "4242" }), 1);
  });

  it("batches Kroger-only UPCs into one Walmart items call", async () => {
    const cokeUpc = "0004900004256";
    const millsKroger = "0001600027528";
    const cokeKey = upcKey(cokeUpc);
    const millsWalmart = walmartUpcForLookup(millsKroger);
    const millsKey = upcKey(millsWalmart ?? "");
    assert.ok(cokeKey);
    assert.ok(millsKey);
    assert.ok(millsWalmart);
    const now = new Date("2026-09-29T16:00:00.000Z");
    await CatalogMaster.deleteMany({ key: { $in: [cokeKey, millsKey] } });
    await CatalogOffer.deleteMany({ productKey: { $in: [cokeKey, millsKey] } });
    await CatalogMaster.create({
      key: cokeKey,
      name: "Coca-Cola Classic",
      brand: "Coca-Cola",
      departmentId: "beverages",
      upc: cokeUpc,
      krogerProductId: cokeUpc,
      lastSeenAt: now,
      status: "active",
    });
    await CatalogMaster.create({
      key: millsKey,
      name: "Cheerios",
      brand: "General Mills",
      departmentId: "breakfast",
      upc: millsKroger,
      krogerProductId: millsKroger,
      lastSeenAt: now,
      status: "active",
    });
    await CatalogMaster.updateMany(
      { key: { $nin: [cokeKey, millsKey] } },
      { $set: { matchWalmartAt: now, matchWalmartVariant: 0 } }
    );
    const seen: string[][] = [];
    const config = ingestConfig();
    config.walmartDailyBudget = 20;
    config.walmartMinIntervalMs = 0;
    config.walmartLookupBatch = 20;
    config.matchLookupShare = 1;
    await IngestCheckpoint.deleteMany({ provider: "walmart" });
    const slice = await stepWalmart({
      client: {
        taxonomy: async () => ({ categories: [] }),
        page: async () => ({ items: [] }),
        lookupUpcs: async (upcs: string[]) => {
          seen.push(upcs);
          return {
            items: [
              { itemId: 4242, name: "Coca-Cola Classic", brandName: "Coca-Cola", salePrice: 1.18, upc: "049000042566" },
              { itemId: 5151, name: "Cheerios", brandName: "General Mills", salePrice: 3.48, upc: millsWalmart },
            ],
          };
        },
      },
      maxCalls: 1,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => now,
    });
    assert.equal(slice.calls, 1);
    assert.equal(seen.length, 1);
    assert.ok(seen[0]?.includes("049000042566"));
    assert.ok(seen[0]?.includes(millsWalmart));
    const coke = await CatalogMaster.findOne({ key: cokeKey });
    const mills = await CatalogMaster.findOne({ key: millsKey });
    assert.equal(coke?.walmartItemId, "4242");
    assert.equal(mills?.walmartItemId, "5151");
    assert.equal(coke?.krogerProductId, cokeUpc);
    assert.ok(coke?.mergedAt);
    const progress = await matchProgress(now);
    assert.ok(progress.hitRate.walmartHits >= 2);
    assert.ok(progress.mergedToday >= 2);
  });

  it("retries a Walmart miss on the next GTIN variant, then waits out the cooldown", async () => {
    const krogerUpc = "0004900004256";
    const key = upcKey(krogerUpc);
    assert.ok(key);
    const codes = walmartLookupCodes(krogerUpc);
    assert.deepEqual(codes, ["049000042566", "0049000042566", "00049000042566"]);
    let clock = Date.parse("2026-09-29T17:00:00.000Z");
    const now = () => new Date(clock);
    await CatalogMaster.deleteMany({ key });
    await CatalogMaster.create({
      key,
      name: "Coca-Cola Classic",
      brand: "Coca-Cola",
      departmentId: "beverages",
      upc: krogerUpc,
      krogerProductId: krogerUpc,
      lastSeenAt: now(),
      status: "active",
    });
    await CatalogMaster.updateMany(
      { key: { $ne: key } },
      { $set: { matchWalmartAt: now(), matchWalmartVariant: 0 } }
    );
    const seen: string[] = [];
    const config = ingestConfig();
    config.walmartDailyBudget = 20;
    config.walmartMinIntervalMs = 0;
    config.walmartLookupBatch = 1;
    config.matchLookupShare = 1;
    config.matchRetryDays = 14;
    await IngestCheckpoint.deleteMany({ provider: "walmart" });
    const client = {
      taxonomy: async () => ({ categories: [] }),
      page: async () => ({ items: [] }),
      lookupUpc: async (upc: string) => {
        seen.push(upc);
        return { items: [] };
      },
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await stepWalmart({
        client,
        maxCalls: 1,
        store: new MemoryBudgetStore(),
        sleep: async () => undefined,
        config,
        now,
      });
      clock += 60_000;
    }
    assert.deepEqual(seen, codes);
    const resting = await CatalogMaster.findOne({ key });
    assert.equal(resting?.walmartItemId ?? "", "");
    assert.ok(resting?.matchWalmartAt);
    await stepWalmart({
      client,
      maxCalls: 1,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now,
    });
    assert.equal(seen.length, 3);
    clock = (resting?.matchWalmartAt?.getTime() ?? clock) + 14 * 86_400_000 + 60_000;
    await stepWalmart({
      client,
      maxCalls: 1,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now,
    });
    assert.equal(seen[3], codes[0]);
  });

  it("does not mark a master tried when Walmart answers 429", async () => {
    const krogerUpc = "0001111041700";
    const key = upcKey(krogerUpc);
    assert.ok(key);
    const now = new Date("2026-09-29T18:00:00.000Z");
    await CatalogMaster.deleteMany({ key });
    await CatalogMaster.create({
      key,
      name: "Store Cola",
      brand: "Store",
      departmentId: "beverages",
      upc: krogerUpc,
      krogerProductId: krogerUpc,
      lastSeenAt: now,
      status: "active",
    });
    await CatalogMaster.updateMany(
      { key: { $ne: key } },
      { $set: { matchWalmartAt: now, matchWalmartVariant: 0 } }
    );
    await IngestCheckpoint.deleteMany({ provider: "walmart" });
    const config = ingestConfig();
    config.walmartDailyBudget = 20;
    config.walmartMinIntervalMs = 0;
    config.walmartLookupBatch = 1;
    const error = new Error("Walmart Affiliate API failed (429)");
    (error as Error & { status: number }).status = 429;
    await stepWalmart({
      client: {
        taxonomy: async () => ({ categories: [] }),
        page: async () => ({ items: [] }),
        lookupUpc: async () => {
          throw error;
        },
      },
      maxCalls: 1,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => now,
    });
    const row = await CatalogMaster.findOne({ key });
    assert.equal(row?.matchWalmartAt, undefined);
    const checkpoint = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{
      checkpoint?: { cooldownUntil?: string; rateStrikes?: number };
    }>();
    assert.equal(checkpoint?.checkpoint?.rateStrikes, 1);
    assert.equal(checkpoint?.checkpoint?.cooldownUntil, "2026-09-29T18:15:00.000Z");
  });

  it("looks up a saved-list item before a staple nobody asked for", async () => {
    const now = new Date("2026-09-29T19:00:00.000Z");
    const listKey = "list-only-paprika";
    const stapleKey = "staple-only-milk";
    await CatalogMaster.deleteMany({ key: { $in: [listKey, stapleKey] } });
    await CatalogOffer.deleteMany({ productKey: stapleKey });
    await CatalogMaster.create({
      key: listKey,
      name: "Paprika Tin",
      brand: "Store",
      departmentId: "other",
      upc: "0009991112223",
      krogerProductId: "0009991112223",
      lastSeenAt: now,
      status: "active",
    });
    await CatalogMaster.create({
      key: stapleKey,
      name: "Whole Milk",
      brand: "Dairy",
      departmentId: "dairy-eggs",
      upc: "0008881112223",
      krogerProductId: "0008881112223",
      lastSeenAt: now,
      status: "active",
    });
    await CatalogOffer.create({
      productKey: stapleKey,
      storeName: "Kroger",
      locationId: "1",
      zip: "45202",
      price: 2,
      lastSeenAt: now,
      status: "active",
    });
    await noteCatalogDemand({ kind: "list", lines: ["2x Paprika Tin"] });
    await CatalogMaster.updateMany(
      { key: { $nin: [listKey, stapleKey] } },
      { $set: { matchWalmartAt: now, matchWalmartVariant: 0 } }
    );
    await CatalogMaster.updateMany(
      { key: { $in: [listKey, stapleKey] } },
      { $unset: { matchWalmartAt: 1, matchWalmartVariant: 1 } }
    );
    const [picked] = await nextWalmartLookups(now, 1);
    assert.equal(picked?.key, listKey);
    assert.equal(picked?.priority, "list");
    const preview = await catalogMatchQueue(now);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.walmart[0]?.key, listKey);
    const untouched = await CatalogMaster.findOne({ key: listKey });
    assert.equal(untouched?.matchWalmartAt, undefined);
  });

  it("looks up a recent search before a staple nobody searched", async () => {
    const now = new Date("2026-09-29T19:30:00.000Z");
    const searchKey = "search-only-sesame";
    const stapleKey = "search-staple-bread";
    await CatalogMaster.deleteMany({ key: { $in: [searchKey, stapleKey] } });
    await CatalogMaster.create({
      key: searchKey,
      name: "Toasted Sesame Oil",
      brand: "Store",
      departmentId: "other",
      upc: "0009992223334",
      krogerProductId: "0009992223334",
      lastSeenAt: now,
      status: "active",
    });
    await CatalogMaster.create({
      key: stapleKey,
      name: "Sliced Bread",
      brand: "Bakery",
      departmentId: "bakery",
      upc: "0008882223334",
      krogerProductId: "0008882223334",
      lastSeenAt: now,
      status: "active",
    });
    await noteCatalogDemand({ kind: "search", lines: ["sesame oil"] });
    await CatalogMaster.updateMany(
      { key: { $nin: [searchKey, stapleKey] } },
      { $set: { matchWalmartAt: now, matchWalmartVariant: 0 } }
    );
    await CatalogMaster.updateMany(
      { key: { $in: [searchKey, stapleKey] } },
      { $unset: { matchWalmartAt: 1, matchWalmartVariant: 1 } }
    );
    const [picked] = await nextWalmartLookups(now, 1);
    assert.equal(picked?.key, searchKey);
    assert.equal(picked?.priority, "search");
  });

  it("spends the configured share of a tick on lookups and keeps crawling with the rest", async () => {
    const now = new Date("2026-09-29T20:00:00.000Z");
    const upcs = ["0004900004256", "0001600027528", "0003700031802"];
    const keys = upcs.map((upc) => upcKey(upc));
    assert.ok(keys.every((key) => key));
    await CatalogMaster.deleteMany({ key: { $in: keys } });
    for (const [index, upc] of upcs.entries()) {
      await CatalogMaster.create({
        key: keys[index],
        name: `Share Item ${index}`,
        brand: "Store",
        departmentId: "pantry",
        upc,
        krogerProductId: upc,
        lastSeenAt: now,
        status: "active",
      });
    }
    await CatalogMaster.updateMany(
      { key: { $nin: keys } },
      { $set: { matchWalmartAt: now, matchWalmartVariant: 0 } }
    );
    await IngestCheckpoint.deleteMany({ provider: "walmart" });
    let lookups = 0;
    let pages = 0;
    const config = ingestConfig();
    config.walmartDailyBudget = 20;
    config.walmartMinIntervalMs = 0;
    config.walmartLookupBatch = 1;
    config.matchLookupShare = 0.5;
    config.refreshShare = 0;
    config.refreshShareWalmart = 0;
    config.refreshShareKroger = 0;
    const slice = await stepWalmart({
      client: {
        taxonomy: async () => ({ categories: [{ id: "pantry", name: "Pantry", path: "Food/Pantry", children: [] }] }),
        page: async () => {
          pages += 1;
          return { items: [], nextPageExist: false };
        },
        lookupUpc: async () => {
          lookups += 1;
          return { items: [] };
        },
      },
      maxCalls: 4,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => now,
    });
    assert.equal(slice.calls, 4);
    assert.equal(lookups, 2);
    assert.equal(pages, 1);
  });

  it("reports Other paths and does not refresh general merchandise", async () => {
    await CatalogMaster.create({
      key: "other-jewelry",
      name: "Personalized Necklace",
      brand: "Walmart",
      departmentId: "other",
      categoryPaths: ["Jewelry/Necklaces"],
      walmartItemId: "jew-1",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: "other-jewelry",
      storeName: "Walmart",
      locationId: "",
      price: 12,
      lastSeenAt: new Date(),
      status: "stale",
    });
    await CatalogMaster.create({
      key: "other-kroger-spice",
      name: "Cumin",
      brand: "Kroger",
      departmentId: "other",
      categoryPaths: ["Spices"],
      krogerProductId: "0001234500001",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogMaster.create({
      key: "other-vitamin",
      name: "Nature Made Vitamin D",
      brand: "Nature Made",
      departmentId: "other",
      categoryPaths: ["Health and Medicine/Vitamins and Supplements"],
      walmartItemId: "vit-1",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: "other-vitamin",
      storeName: "Walmart",
      locationId: "",
      price: 8,
      lastSeenAt: new Date(),
      status: "stale",
    });
    const breakdown = await catalogOtherBreakdown(100);
    assert.ok(breakdown.products >= 3);
    assert.ok(breakdown.withKrogerId >= 1);
    const jewelry = breakdown.paths.find((row) => row.path === "Jewelry/Necklaces");
    assert.ok(jewelry);
    assert.equal(jewelry.count >= 1, true);
    assert.ok(jewelry.examples.some((name) => name.includes("Necklace")));
    const excluded = await excludeNongroceryFromRefresh();
    assert.ok(excluded.masters >= 1);
    assert.ok(excluded.offers >= 1);
    assert.equal((await CatalogOffer.findOne({ productKey: "other-jewelry" }))?.refreshExcluded, true);
    assert.notEqual((await CatalogOffer.findOne({ productKey: "other-vitamin" }))?.refreshExcluded, true);
    assert.equal(await CatalogMaster.countDocuments({ key: "other-jewelry" }), 1);
    assert.equal(await CatalogOffer.countDocuments({ productKey: "other-jewelry" }), 1);
  });

  it("refreshes a saved-list stale offer ahead of an older one", async () => {
    await CatalogOffer.updateMany({ status: "stale" }, { $set: { refreshExcluded: true } });
    // catalogStatus() counts refreshedToday on the real UTC day. The injected
    // clock has to be that same day or the assertion is false after 2026-10-23.
    const now = new Date();
    const listUpc = "049000042566";
    const oldUpc = "016000275287";
    const listKey = upcKey(listUpc);
    const oldKey = upcKey(oldUpc);
    assert.ok(listKey && oldKey && walmartUpcForLookup(listUpc) && walmartUpcForLookup(oldUpc));
    await CatalogMaster.deleteMany({ key: { $in: [listKey, oldKey] } });
    await CatalogOffer.deleteMany({ productKey: { $in: [listKey, oldKey] } });
    await CatalogMaster.create({
      key: listKey,
      name: "Coca-Cola",
      brand: "Coca-Cola",
      departmentId: "beverages",
      upc: listUpc,
      walmartItemId: "coke-1",
      lastSeenAt: now,
      status: "active",
    });
    await CatalogMaster.create({
      key: oldKey,
      name: "Cheerios",
      brand: "General Mills",
      departmentId: "breakfast",
      upc: oldUpc,
      walmartItemId: "cereal-1",
      lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: listKey,
      storeName: "Walmart",
      locationId: "",
      price: 1.28,
      lastSeenAt: now,
      status: "stale",
    });
    await CatalogOffer.create({
      productKey: oldKey,
      storeName: "Walmart",
      locationId: "",
      price: 3.5,
      lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "stale",
    });
    await noteCatalogDemand({ kind: "list", upcs: [listUpc] });
    const [picked] = await nextRefreshPicks("Walmart", now, 1);
    assert.equal(picked?.productKey, listKey);
    assert.equal(picked?.priority, "list");
    await IngestCheckpoint.deleteMany({ provider: "walmart" });
    const seen: string[][] = [];
    const config = ingestConfig();
    config.walmartDailyBudget = 20;
    config.walmartMinIntervalMs = 0;
    config.walmartLookupBatch = 1;
    config.matchLookupShare = 0;
    config.refreshShare = 1;
    config.refreshShareWalmart = 1;
    config.refreshShareKroger = 1;
    const slice = await stepWalmart({
      client: {
        taxonomy: async () => ({ categories: [] }),
        page: async () => ({ items: [], nextPageExist: false }),
        lookupUpcs: async (upcs: string[]) => {
          seen.push(upcs);
          return {
            items: [
              {
                itemId: 77,
                name: "Coca-Cola",
                brandName: "Coca-Cola",
                salePrice: 1.19,
                upc: upcs[0],
              },
            ],
          };
        },
      },
      maxCalls: 1,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => now,
    });
    assert.equal(slice.calls, 1);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.[0], walmartUpcForLookup(listUpc));
    assert.equal((await CatalogOffer.findOne({ productKey: listKey, storeName: "Walmart" }))?.status, "active");
    const status = await catalogStatus();
    const recorded = await CatalogRefreshDay.findOne({ day: utcDay(now) }).lean<{ walmart?: number } | null>();
    assert.equal((recorded?.walmart ?? 0) >= 1, true);
    assert.equal(typeof status.counts.refreshedToday.walmart, "number");
    assert.equal(typeof status.counts.refreshQueue.walmart, "number");
    assert.equal(typeof status.refresh.share, "number");
    assert.equal(status.refresh.shareKroger, ingestConfig().refreshShareKroger);
    assert.equal(typeof status.refresh.effective.walmart.refreshShare, "number");
    assert.equal(typeof status.refresh.effective.kroger.lookupShare, "number");
    assert.equal(typeof status.match.effectiveLookupShare.walmart, "number");
    assert.ok(["refresh", "balanced", "discover"].includes(status.refresh.mode));
    const shelf = status.counts.offers - status.counts.discontinuedOffers;
    const expectedRatio = shelf <= 0 ? 0 : Math.round((status.counts.staleOffers / shelf) * 1000) / 1000;
    assert.equal(status.refresh.staleRatio, expectedRatio);
  });

  it("rewrites a Walmart api-proxy nextPage and advances past a category that still fails", async () => {
    await IngestCheckpoint.deleteMany({ provider: "walmart" });
    const bad = "/api-proxy/service/affil/product/v2/paginated/items?category=milk&count=25&page=2";
    const paths: string[] = [];
    let milkPageFails = 0;
    const config = ingestConfig();
    config.walmartDailyBudget = 20;
    config.walmartMinIntervalMs = 0;
    config.matchLookupShare = 0;
    config.refreshShare = 0;
    config.refreshShareWalmart = 0;
    config.refreshShareKroger = 0;
    const slice = await stepWalmart({
      client: {
        taxonomy: async () => ({
          categories: [
            { id: "milk", name: "Milk", path: "Food/Dairy/Milk", children: [] },
            { id: "cereal", name: "Cereal", path: "Food/Breakfast Foods/Cereal", children: [] },
          ],
        }),
        page: async (path: string) => {
          paths.push(path);
          assert.equal(path.includes("/api-proxy/"), false, path);
          assert.match(path, /^\/paginated\/items\?/);
          if (path.includes("category=milk") && path.includes("page=2")) {
            milkPageFails += 1;
            const error = new Error("No endpoint GET /api-proxy/service/affil/product/v2/paginated/items");
            (error as Error & { status: number }).status = 404;
            throw error;
          }
          if (path.includes("category=milk")) {
            return {
              items: [
                {
                  itemId: 111,
                  name: "Whole Milk",
                  brandName: "Dairy Pure",
                  salePrice: 3.18,
                  upc: "00055566677788",
                },
              ],
              nextPage: bad,
              nextPageExist: true,
            };
          }
          return { items: [], nextPageExist: false };
        },
      },
      maxCalls: 6,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      staleRatio: 0,
      now: () => new Date("2026-10-26T12:00:00.000Z"),
    });
    assert.equal(slice.paused, null);
    assert.equal(milkPageFails, 2);
    assert.ok(paths.some((path) => path === "/paginated/items?category=milk&count=25&page=2"));
    assert.ok(paths.some((path) => path.includes("category=cereal")));
    const saved = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{
      checkpoint?: { index?: number; nextPage?: string | null; pageFallback?: boolean };
    }>();
    assert.equal(saved?.checkpoint?.nextPage ?? null, null);
    assert.equal(saved?.checkpoint?.pageFallback ?? false, false);
    assert.ok((saved?.checkpoint?.index ?? 0) >= 1);
  });

  it("refreshes shared and popular offers before older ones and skips refresh-excluded items", async () => {
    await CatalogOffer.updateMany({ status: "stale" }, { $set: { refreshExcluded: true } });
    const now = new Date();
    const sharedUpc = "049000042566";
    const popularUpc = "0003700031802";
    const oldUpc = "070708200500";
    const excludedUpc = "0001600027528";
    const sharedKey = upcKey(sharedUpc);
    const popularKey = upcKey(popularUpc);
    const oldKey = upcKey(oldUpc);
    const excludedKey = upcKey(excludedUpc);
    assert.ok(sharedKey && popularKey && oldKey && excludedKey);
    assert.ok(
      walmartUpcForLookup(sharedUpc) &&
        walmartUpcForLookup(popularUpc) &&
        walmartUpcForLookup(oldUpc) &&
        walmartUpcForLookup(excludedUpc)
    );
    const keys = [sharedKey, popularKey, oldKey, excludedKey];
    await CatalogDemand.deleteMany({ $or: [{ upcKey: { $in: keys } }, { text: { $in: keys.map((key) => `upc:${key}`) } }] });
    await CatalogMaster.deleteMany({ key: { $in: keys } });
    await CatalogOffer.deleteMany({ productKey: { $in: keys } });
    await SharedList.deleteMany({ shareTokenHash: "catalog-health-share" });
    const rows = [
      { key: sharedKey, upc: sharedUpc, name: "Shared Soda", at: now, excluded: false },
      { key: popularKey, upc: popularUpc, name: "Popular Beans", at: new Date("2026-02-01T00:00:00.000Z"), excluded: false },
      { key: oldKey, upc: oldUpc, name: "Old Chips", at: new Date("2025-01-01T00:00:00.000Z"), excluded: false },
      { key: excludedKey, upc: excludedUpc, name: "Excluded Cereal", at: new Date("2024-01-01T00:00:00.000Z"), excluded: true },
    ];
    for (const row of rows) {
      await CatalogMaster.create({
        key: row.key,
        name: row.name,
        brand: "Store",
        departmentId: "pantry",
        upc: row.upc,
        walmartItemId: row.key,
        lastSeenAt: row.at,
        status: "active",
      });
      await CatalogOffer.create({
        productKey: row.key,
        storeName: "Walmart",
        locationId: "",
        price: 1,
        lastSeenAt: row.at,
        status: "stale",
        ...(row.excluded ? { refreshExcluded: true } : {}),
      });
    }
    await SharedList.create({
      shareTokenHash: "catalog-health-share",
      ownerTokenHash: "catalog-health-owner",
      title: "Week",
      mode: "edit",
      revokedAt: null,
      items: [
        {
          itemId: "1",
          catalogId: sharedKey,
          name: "Shared Soda",
          quantity: 1,
          writtenAt: Date.now(),
          updatedAt: now,
          deleted: false,
        },
      ],
    });
    await noteCatalogDemand({ kind: "search", upcs: [popularUpc] });
    const marked = await CatalogDemand.updateOne({ kind: "search", upcKey: popularKey }, { $set: { hits: 5 } });
    assert.equal(marked.matchedCount, 1);
    await noteCatalogDemand({ kind: "list", upcs: [excludedUpc] });
    const picks = await nextRefreshPicks("Walmart", now, 3);
    assert.deepEqual(
      picks.map((pick) => pick.productKey),
      [sharedKey, popularKey, oldKey]
    );
    assert.equal(picks[0]?.priority, "shared");
    assert.equal(picks[1]?.priority, "popular");
    assert.equal(picks[2]?.priority, "catalog");
    assert.equal(
      picks.some((pick) => pick.productKey === excludedKey),
      false
    );
  });

  it("keeps the Walmart daily budget at the configured value and clamps it to 1500", () => {
    const previous = {
      budget: process.env.WALMART_INGEST_DAILY_BUDGET,
      refresh: process.env.CATALOG_REFRESH_SHARE,
      walmart: process.env.CATALOG_REFRESH_SHARE_WALMART,
      kroger: process.env.CATALOG_REFRESH_SHARE_KROGER,
    };
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    };
    try {
      delete process.env.WALMART_INGEST_DAILY_BUDGET;
      delete process.env.CATALOG_REFRESH_SHARE;
      delete process.env.CATALOG_REFRESH_SHARE_WALMART;
      delete process.env.CATALOG_REFRESH_SHARE_KROGER;
      assert.equal(ingestConfig().walmartDailyBudget, 500);
      assert.equal(ingestConfig().refreshShare, 0.3);
      assert.equal(ingestConfig().refreshShareWalmart, 0.3);
      assert.equal(ingestConfig().refreshShareKroger, 0.6);
      process.env.WALMART_INGEST_DAILY_BUDGET = "1500";
      assert.equal(ingestConfig().walmartDailyBudget, 1500);
      process.env.WALMART_INGEST_DAILY_BUDGET = "5000";
      assert.equal(ingestConfig().walmartDailyBudget, 1500);
      process.env.WALMART_INGEST_DAILY_BUDGET = "400";
      assert.equal(ingestConfig().walmartDailyBudget, 400);
      process.env.CATALOG_REFRESH_SHARE_KROGER = "0.7";
      process.env.CATALOG_REFRESH_SHARE_WALMART = "0.45";
      assert.equal(ingestConfig().refreshShareKroger, 0.7);
      assert.equal(ingestConfig().refreshShareWalmart, 0.45);
      assert.equal(ingestConfig().walmartDailyBudget <= 1500, true);
    } finally {
      restore("WALMART_INGEST_DAILY_BUDGET", previous.budget);
      restore("CATALOG_REFRESH_SHARE", previous.refresh);
      restore("CATALOG_REFRESH_SHARE_WALMART", previous.walmart);
      restore("CATALOG_REFRESH_SHARE_KROGER", previous.kroger);
    }
  });

  it("sends a 13-digit Kroger id and treats a lookup 400 as a miss", async () => {
    const walmartUpc = "070708200500";
    const productId = krogerProductIdForLookup(walmartUpc);
    const key = upcKey(walmartUpc);
    assert.equal(productId, "0007070820050");
    assert.ok(key);
    const now = new Date("2026-10-23T16:00:00.000Z");
    await CatalogMaster.deleteMany({ key });
    await CatalogOffer.deleteMany({ productKey: key });
    await CatalogMaster.create({
      key,
      name: "Bush's Black Beans",
      brand: "Bush's Best",
      departmentId: "pantry",
      upc: walmartUpc,
      walmartItemId: "beans-1",
      lastSeenAt: now,
      status: "active",
    });
    await CatalogMaster.updateMany({ key: { $ne: key } }, { $set: { matchKrogerAt: now, matchKrogerVariant: 0 } });
    await IngestCheckpoint.deleteMany({ provider: "kroger" });
    await IngestCheckpoint.create({
      provider: "kroger",
      status: "running",
      checkpoint: {
        termsVersion: KROGER_TERMS_VERSION,
        phase: "queries",
        plannedZips: ["45255"],
        zipCursor: 1,
        locations: [{ zip: "45255", locationId: "01400431" }],
        locationIndex: 0,
        queryIndex: 4,
        start: 0,
        pageIndex: 0,
        attempts: 0,
        pendingZips: [],
        clientErrorStreak: 2,
        clientErrorLocationId: "01400431",
        cycleStartedAt: now.toISOString(),
      },
    });
    const seenIds: string[] = [];
    const seenTerms: string[] = [];
    const config = ingestConfig();
    config.krogerDailyBudget = 20;
    config.krogerMinIntervalMs = 0;
    config.matchLookupShare = 1;
    config.refreshShare = 0;
    config.refreshShareWalmart = 0;
    config.refreshShareKroger = 0;
    await stepKroger({
      client: {
        resolveLocation: async () => "01400431",
        page: async () => {
          throw new Error("discovery should not run");
        },
        lookupProductId: async (id: string) => {
          seenIds.push(id);
          const error = new Error("Kroger products request failed (400)");
          (error as Error & { status: number }).status = 400;
          throw error;
        },
        lookupTerm: async (term: string) => {
          seenTerms.push(term);
          return {
            returned: 1,
            records: [
              {
                name: "Bush's Black Beans",
                brand: "Bush's Best",
                storeName: "Kroger",
                price: 0.86,
                upc: "0007070820050",
                productId,
                priceSource: "live" as const,
                categories: ["Canned Goods"],
              },
            ],
          };
        },
      },
      maxCalls: 2,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => now,
    });
    assert.deepEqual(seenIds, [productId]);
    assert.deepEqual(seenTerms, ["Bush's Black Beans"]);
    const row = await CatalogMaster.findOne({ key });
    assert.equal(row?.krogerProductId, productId);
    assert.equal(row?.walmartItemId, "beans-1");
    const saved = await IngestCheckpoint.findOne({ provider: "kroger" }).lean<{
      lastError?: string;
      checkpoint?: { clientErrorStreak?: number; queryIndex?: number; phase?: string };
    }>();
    assert.equal(saved?.lastError ?? "", "");
    assert.equal(saved?.checkpoint?.clientErrorStreak, 2);
    assert.equal(saved?.checkpoint?.queryIndex, 4);
    assert.equal(saved?.checkpoint?.phase, "queries");
  });

  it("clears a premature refresh exclusion and is idempotent", async () => {
    await CatalogMaster.create({
      key: "other-ensure",
      name: "Ensure Original Nutrition Shake",
      brand: "Ensure",
      departmentId: "other",
      categoryPaths: ["Health and Medicine/Weight Loss"],
      walmartItemId: "ensure-1",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: "other-ensure",
      storeName: "Walmart",
      locationId: "",
      price: 9,
      lastSeenAt: new Date(),
      status: "stale",
      refreshExcluded: true,
    });
    await CatalogMaster.updateOne(
      { key: "other-jewelry" },
      {
        $setOnInsert: {
          name: "Personalized Necklace",
          brand: "Walmart",
          departmentId: "other",
          categoryPaths: ["Jewelry/Necklaces"],
          walmartItemId: "jew-1",
          lastSeenAt: new Date(),
          status: "active",
        },
      },
      { upsert: true }
    );
    await CatalogOffer.updateOne(
      { productKey: "other-jewelry", storeName: "Walmart", locationId: "" },
      { $set: { price: 12, lastSeenAt: new Date(), status: "stale", refreshExcluded: true } },
      { upsert: true }
    );
    const first = await excludeNongroceryFromRefresh();
    assert.equal((await CatalogOffer.findOne({ productKey: "other-ensure" }))?.refreshExcluded, false);
    assert.equal((await CatalogOffer.findOne({ productKey: "other-jewelry" }))?.refreshExcluded, true);
    assert.ok(first.cleared >= 1);
    assert.ok(first.masters >= 1);
    const second = await excludeNongroceryFromRefresh();
    assert.equal(second.cleared, 0);
    assert.equal(second.masters, first.masters);
    assert.equal((await CatalogOffer.findOne({ productKey: "other-jewelry" }))?.refreshExcluded, true);
    assert.equal((await CatalogOffer.findOne({ productKey: "other-ensure" }))?.refreshExcluded, false);
    assert.equal(await CatalogMaster.countDocuments({ key: "other-ensure" }), 1);
  });

  it("recategorize clears refresh exclusion when a product leaves Other", async () => {
    await CatalogOffer.updateOne({ productKey: "other-ensure" }, { $set: { refreshExcluded: true } });
    const started = await startRecategorizeJob();
    assert.ok(started.jobId);
    const finished = await recategorizeCatalog();
    assert.equal(finished.status, "completed");
    assert.ok(finished.examined > 0);
    assert.equal((await CatalogMaster.findOne({ key: "other-ensure" }))?.departmentId, "beverages");
    assert.equal((await CatalogOffer.findOne({ productKey: "other-ensure" }))?.refreshExcluded, false);
    assert.equal((await CatalogMaster.findOne({ key: "other-jewelry" }))?.departmentId, "other");
    assert.equal((await CatalogOffer.findOne({ productKey: "other-jewelry" }))?.refreshExcluded, true);
    const status = await catalogStatus();
    assert.equal(status.recategorize.status, "completed");
    assert.equal(status.recategorize.jobId, finished.jobId);
  });

  it("clears refresh exclusion when a named vitamin leaves Other", async () => {
    await CatalogMaster.create({
      key: "other-b-complex",
      name: "Nature Made Super B-Complex With Vitamin C & Folic Acid Twin Pack Tablets 100 ct Vitamins 2 ct",
      brand: "Nature Made",
      departmentId: "other",
      categoryPaths: ["Health and Medicine/Letter Vitamins/Vitamin B Complex"],
      walmartItemId: "10535957",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: "other-b-complex",
      storeName: "Walmart",
      locationId: "",
      price: 7.52,
      lastSeenAt: new Date(),
      status: "stale",
      refreshExcluded: true,
    });
    const finished = await recategorizeCatalog();
    assert.equal(finished.status, "completed");
    const master = await CatalogMaster.findOne({ key: "other-b-complex" });
    assert.equal(master?.departmentId, "personal-care");
    assert.equal(master?.subcategory, "Health");
    assert.equal((await CatalogOffer.findOne({ productKey: "other-b-complex" }))?.refreshExcluded, false);
    assert.ok(finished.clearedExclusions >= 1);
    await excludeNongroceryFromRefresh();
    assert.equal((await CatalogOffer.findOne({ productKey: "other-b-complex" }))?.refreshExcluded, false);
    assert.equal(await CatalogMaster.countDocuments({ key: "other-b-complex" }), 1);
  });

  it("clears refresh exclusion when allergy, pet food, training pants, and seeds leave Other", async () => {
    const rows = [
      {
        key: "other-allergy",
        name: "Benadryl Allergy Ultratabs",
        categoryPaths: ["Health and Medicine"],
        departmentId: "personal-care",
      },
      {
        key: "other-dog-food",
        name: "Iams ProActive Health Adult Dry Dog Food",
        categoryPaths: ["Toys/Plush"],
        departmentId: "pet",
      },
      {
        key: "other-training-pants",
        name: "Parent's Choice Training Pants",
        categoryPaths: ["Clothing/Baby"],
        departmentId: "baby",
      },
      {
        key: "other-chia",
        name: "Sanar Naturals Raw Black Chia Seeds, High Fiber, Omega-3",
        categoryPaths: ["Health and Medicine"],
        departmentId: "pantry",
      },
    ];
    for (const row of rows) {
      await CatalogMaster.create({
        key: row.key,
        name: row.name,
        brand: "Store",
        departmentId: "other",
        categoryPaths: row.categoryPaths,
        walmartItemId: row.key,
        lastSeenAt: new Date(),
        status: "active",
      });
      await CatalogOffer.create({
        productKey: row.key,
        storeName: "Walmart",
        locationId: "",
        price: 4,
        lastSeenAt: new Date(),
        status: "stale",
        refreshExcluded: true,
      });
    }
    const finished = await recategorizeCatalog();
    assert.equal(finished.status, "completed");
    assert.ok(finished.clearedExclusions >= rows.length);
    for (const row of rows) {
      const master = await CatalogMaster.findOne({ key: row.key });
      assert.equal(master?.departmentId, row.departmentId, row.key);
      assert.equal((await CatalogOffer.findOne({ productKey: row.key }))?.refreshExcluded, false, row.key);
    }
    await excludeNongroceryFromRefresh();
    for (const row of rows) {
      assert.equal((await CatalogOffer.findOne({ productKey: row.key }))?.refreshExcluded, false, row.key);
      assert.equal(await CatalogMaster.countDocuments({ key: row.key }), 1);
    }
    assert.equal((await CatalogOffer.findOne({ productKey: "other-jewelry" }))?.refreshExcluded, true);
  });

  it("moves Halloween dog apparel out of dairy and sets refresh exclusion both ways", async () => {
    const dogs = [
      {
        key: "dairy-dog-dress",
        name: "Way To Celebrate Dog Dress, Orange & Black Polka Dot Pumpkin Face, (XS)",
        brand: "Way To Celebrate",
        categoryPaths: ["Food/Dairy, Eggs & Cheese/Seasonal/Halloween"],
      },
      {
        key: "dairy-dog-scary",
        name: "Way To Celebrate Dog Halloween Dress, Red So Cute It's Scary, (Small)",
        brand: "Parent's Choice",
        categoryPaths: ["Food/Dairy, Eggs & Cheese"],
      },
      {
        key: "dairy-dog-med",
        name: "Way To Celebrate Dog Sweater, Orange Leafy Pumpkin, (Medium)",
        brand: "Way To Celebrate",
        categoryPaths: ["Food/Dairy, Eggs & Cheese/Seasonal/Halloween/Dog Sweaters"],
      },
      {
        key: "dairy-dog-xs",
        name: "Way To Celebrate Dog Sweater, Orange Leafy Pumpkin, (XS)",
        brand: "Way To Celebrate",
        categoryPaths: ["Food/Seasonal/Halloween"],
      },
    ];
    for (const row of dogs) {
      await CatalogMaster.create({
        key: row.key,
        name: row.name,
        brand: row.brand,
        departmentId: "dairy-eggs",
        categoryPaths: row.categoryPaths,
        walmartItemId: row.key,
        lastSeenAt: new Date(),
        status: "active",
      });
      await CatalogOffer.create({
        productKey: row.key,
        storeName: "Walmart",
        locationId: "",
        price: 0.75,
        lastSeenAt: new Date(),
        status: "stale",
        refreshExcluded: false,
      });
    }
    await CatalogMaster.create({
      key: "dairy-milk-flagged",
      name: "Great Value Whole Milk",
      brand: "Great Value",
      departmentId: "dairy-eggs",
      categoryPaths: ["Food/Dairy, Eggs & Cheese/Milk"],
      walmartItemId: "dairy-milk-flagged",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: "dairy-milk-flagged",
      storeName: "Walmart",
      locationId: "",
      price: 3.18,
      lastSeenAt: new Date(),
      status: "stale",
      refreshExcluded: true,
    });
    await CatalogMaster.create({
      key: "dairy-gerber-juice",
      name: "Gerber Gerber Juice, 4 oz",
      brand: "Gerber",
      departmentId: "dairy-eggs",
      categoryPaths: ["Food/Dairy, Eggs & Cheese"],
      walmartItemId: "dairy-gerber-juice",
      lastSeenAt: new Date(),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: "dairy-gerber-juice",
      storeName: "Walmart",
      locationId: "",
      price: 0.68,
      size: "4 oz",
      lastSeenAt: new Date(),
      status: "stale",
      refreshExcluded: false,
    });

    const before = await catalogSuspicious(100);
    const dairyBefore = before.departments.find((row) => row.id === "dairy-eggs");
    assert.ok(dairyBefore);
    assert.ok((dairyBefore?.suspicious ?? 0) >= dogs.length);
    assert.equal(before.departments.some((row) => row.id === "other"), false);
    assert.ok(before.items.some((row) => row.name.includes("Dog Sweater") && row.hint === "pet-apparel"));
    assert.equal(before.items.some((row) => row.name.includes("Gerber")), false);

    const finished = await recategorizeCatalog();
    assert.equal(finished.status, "completed");
    assert.ok(finished.setExclusions >= dogs.length);
    assert.ok(finished.clearedExclusions >= 1);
    for (const row of dogs) {
      assert.equal((await CatalogMaster.findOne({ key: row.key }))?.departmentId, "other", row.key);
      assert.equal((await CatalogOffer.findOne({ productKey: row.key }))?.refreshExcluded, true, row.key);
    }
    assert.equal((await CatalogMaster.findOne({ key: "dairy-milk-flagged" }))?.departmentId, "dairy-eggs");
    assert.equal((await CatalogOffer.findOne({ productKey: "dairy-milk-flagged" }))?.refreshExcluded, false);
    const juice = await CatalogMaster.findOne({ key: "dairy-gerber-juice" });
    assert.notEqual(juice?.departmentId, "other");
    assert.equal((await CatalogOffer.findOne({ productKey: "dairy-gerber-juice" }))?.refreshExcluded, false);

    const after = await catalogSuspicious(100);
    const dairyAfter = after.departments.find((row) => row.id === "dairy-eggs");
    assert.equal(dairyAfter?.suspicious ?? 0, (dairyBefore?.suspicious ?? 0) - dogs.length);
    assert.equal(
      after.items.some((row) => dogs.some((dog) => row.name === dog.name)),
      false
    );

    const excluded = await excludeNongroceryFromRefresh();
    assert.ok(excluded.masters >= 1);
    for (const row of dogs) {
      assert.equal((await CatalogOffer.findOne({ productKey: row.key }))?.refreshExcluded, true, row.key);
      assert.equal(await CatalogMaster.countDocuments({ key: row.key }), 1);
    }
    assert.equal((await CatalogOffer.findOne({ productKey: "dairy-milk-flagged" }))?.refreshExcluded, false);
    assert.equal((await CatalogOffer.findOne({ productKey: "dairy-gerber-juice" }))?.refreshExcluded, false);

    const again = await recategorizeCatalog();
    assert.equal(again.status, "completed");
    assert.equal(again.setExclusions, 0);
    for (const row of dogs) {
      assert.equal((await CatalogOffer.findOne({ productKey: row.key }))?.refreshExcluded, true, row.key);
    }
    assert.equal((await CatalogOffer.findOne({ productKey: "dairy-milk-flagged" }))?.refreshExcluded, false);
  });

  it("writes a new dog sweater as Other with refresh excluded when the leaf says dairy", async () => {
    const name = "Way To Celebrate Dog Sweater, Orange Leafy Pumpkin, (Medium)";
    await upsertCatalogRecords([
      {
        name,
        brand: "Way To Celebrate",
        storeName: "Walmart",
        price: 0.75,
        retailerItemId: "dog-sweater-upsert",
        categories: ["Food/Dairy, Eggs & Cheese/Seasonal/Halloween"],
        departmentId: "dairy-eggs",
        priceSource: "live",
      },
    ]);
    const master = await CatalogMaster.findOne({ key: "local:walmart:dog-sweater-upsert" });
    assert.ok(master);
    assert.equal(master?.departmentId, "other");
    assert.equal((await CatalogOffer.findOne({ productKey: "local:walmart:dog-sweater-upsert" }))?.refreshExcluded, true);

    await upsertCatalogRecords([
      {
        name: "Gerber Gerber Juice, 4 oz",
        brand: "Gerber",
        storeName: "Walmart",
        price: 0.72,
        retailerItemId: "gerber-juice-upsert",
        size: "4 fl oz",
        categories: ["Food/Beverages/Juice"],
        departmentId: "beverages",
        priceSource: "live",
      },
    ]);
    const juice = await CatalogMaster.findOne({ key: "local:walmart:gerber-juice-upsert" });
    assert.equal(juice?.departmentId, "beverages");
    assert.notEqual((await CatalogOffer.findOne({ productKey: "local:walmart:gerber-juice-upsert" }))?.refreshExcluded, true);
  });

  it("moves ingested auto and RV rows to other and keeps them off the refresh queue", async () => {
    const rows = [
      {
        key: "auto-cleaner",
        name: "Chemical Guys Nonsense Automotive Cleaner",
        categoryPaths: ["Auto & Tires/Automotive Chemicals/Cleaners"],
      },
      {
        key: "rv-waste",
        name: "Walex Porta-Pak RV Waste Water Treatment",
        categoryPaths: ["Auto & Tires/RV/Waste Water"],
      },
      {
        key: "engine-degreaser",
        name: "Gunk Engine Brite Degreaser",
        categoryPaths: ["Auto & Tires/Exterior Care/Degreasers"],
      },
      {
        key: "real-paper",
        name: "Bounty Paper Towels",
        categoryPaths: ["Household Essentials/Paper"],
      },
    ];
    await CatalogMaster.deleteMany({ key: { $in: rows.map((row) => row.key) } });
    await CatalogOffer.deleteMany({ productKey: { $in: rows.map((row) => row.key) } });
    for (const row of rows) {
      await CatalogMaster.create({
        key: row.key,
        name: row.name,
        brand: "Walmart",
        departmentId: "household",
        categoryPaths: row.categoryPaths,
        walmartItemId: row.key,
        lastSeenAt: new Date(),
        status: "active",
      });
      await CatalogOffer.create({
        productKey: row.key,
        storeName: "Walmart",
        locationId: "",
        price: 6,
        lastSeenAt: new Date(),
        status: "stale",
      });
    }
    const finished = await recategorizeCatalog();
    assert.equal(finished.status, "completed");
    assert.equal((await CatalogMaster.findOne({ key: "auto-cleaner" }))?.departmentId, "other");
    assert.equal((await CatalogMaster.findOne({ key: "rv-waste" }))?.departmentId, "other");
    assert.equal((await CatalogMaster.findOne({ key: "engine-degreaser" }))?.departmentId, "other");
    assert.equal((await CatalogMaster.findOne({ key: "real-paper" }))?.departmentId, "household");
    assert.equal((await CatalogOffer.findOne({ productKey: "auto-cleaner" }))?.refreshExcluded, true);
    assert.equal((await CatalogOffer.findOne({ productKey: "rv-waste" }))?.refreshExcluded, true);
    assert.equal((await CatalogOffer.findOne({ productKey: "engine-degreaser" }))?.refreshExcluded, true);
    assert.notEqual((await CatalogOffer.findOne({ productKey: "real-paper" }))?.refreshExcluded, true);

    const excluded = await excludeNongroceryFromRefresh();
    assert.ok(excluded.masters >= 3);
    assert.equal((await CatalogOffer.findOne({ productKey: "engine-degreaser" }))?.refreshExcluded, true);
    assert.equal((await CatalogOffer.findOne({ productKey: "real-paper" }))?.refreshExcluded, false);
    assert.equal(await CatalogMaster.countDocuments({ key: "auto-cleaner" }), 1);
    assert.equal(await CatalogOffer.countDocuments({ productKey: "auto-cleaner" }), 1);
  });

  it("does not refresh an automotive cleaner that is still stored as household", async () => {
    const now = new Date();
    const paperUpc = "049000042566";
    const paperKey = upcKey(paperUpc);
    assert.ok(paperKey);
    await CatalogMaster.deleteMany({ key: { $in: ["auto-still-household", paperKey] } });
    await CatalogOffer.deleteMany({ productKey: { $in: ["auto-still-household", paperKey] } });
    await CatalogOffer.updateMany({ status: "stale" }, { $set: { refreshExcluded: true } });
    await CatalogMaster.create({
      key: "auto-still-household",
      name: "Chemical Guys Automotive Cleaner",
      brand: "Chemical Guys",
      departmentId: "household",
      categoryPaths: ["Auto & Tires/Automotive Chemicals/Cleaners"],
      upc: "070708200500",
      walmartItemId: "auto-1",
      lastSeenAt: new Date("2024-01-01T00:00:00.000Z"),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: "auto-still-household",
      storeName: "Walmart",
      locationId: "",
      price: 8,
      lastSeenAt: new Date("2024-01-01T00:00:00.000Z"),
      status: "stale",
    });
    await CatalogMaster.create({
      key: paperKey,
      name: "Bounty Paper Towels",
      brand: "Bounty",
      departmentId: "household",
      categoryPaths: ["Household Essentials/Paper"],
      upc: paperUpc,
      walmartItemId: "paper-1",
      lastSeenAt: now,
      status: "active",
    });
    await CatalogOffer.create({
      productKey: paperKey,
      storeName: "Walmart",
      locationId: "",
      price: 4,
      lastSeenAt: now,
      status: "stale",
    });
    const picks = await nextRefreshPicks("Walmart", now, 5);
    assert.equal(
      picks.some((pick) => pick.productKey === "auto-still-household"),
      false
    );
    assert.equal(picks.some((pick) => pick.productKey === paperKey), true);
    assert.equal((await CatalogOffer.findOne({ productKey: "auto-still-household" }))?.refreshExcluded, true);
    assert.notEqual((await CatalogOffer.findOne({ productKey: paperKey }))?.refreshExcluded, true);
  });

  it("skips Walmart-only and auto rows at Kroger and does not retry a miss the next day", async () => {
    const now = new Date("2026-10-27T15:00:00.000Z");
    const yesterday = new Date("2026-10-26T15:00:00.000Z");
    const tideUpc = "049000042566";
    const tideKey = upcKey(tideUpc);
    const gvUpc = "070708200500";
    const gvKey = upcKey(gvUpc);
    const recentUpc = "016000275287";
    const recentKey = upcKey(recentUpc);
    assert.ok(tideKey && gvKey && recentKey);
    const keys = [tideKey, gvKey, recentKey, "auto-kroger-lookup"];
    await CatalogMaster.deleteMany({ key: { $in: keys } });
    await CatalogMaster.create({
      key: tideKey,
      name: "Tide Laundry Detergent",
      brand: "Tide",
      departmentId: "household",
      categoryPaths: ["Household Essentials/Laundry"],
      upc: tideUpc,
      walmartItemId: "tide-1",
      lastSeenAt: now,
      status: "active",
    });
    await CatalogMaster.create({
      key: gvKey,
      name: "Great Value Black Beans",
      brand: "Great Value",
      departmentId: "pantry",
      categoryPaths: ["Food/Pantry/Canned"],
      upc: gvUpc,
      walmartItemId: "gv-1",
      lastSeenAt: now,
      status: "active",
    });
    await CatalogMaster.create({
      key: "auto-kroger-lookup",
      name: "Gunk Engine Degreaser",
      brand: "Gunk",
      departmentId: "household",
      categoryPaths: ["Auto & Tires/Exterior Care/Degreasers"],
      upc: "003063880160",
      walmartItemId: "gunk-1",
      lastSeenAt: now,
      status: "active",
    });
    await CatalogMaster.create({
      key: recentKey,
      name: "Cheerios",
      brand: "General Mills",
      departmentId: "breakfast",
      categoryPaths: ["Food/Breakfast Foods/Cereal"],
      upc: recentUpc,
      walmartItemId: "cheerios-1",
      matchKrogerAt: yesterday,
      matchKrogerVariant: 2,
      lastSeenAt: now,
      status: "active",
    });
    await CatalogMaster.updateMany({ key: { $nin: keys } }, { $set: { matchKrogerAt: now, matchKrogerVariant: 0 } });
    const picks = await nextKrogerLookups(now, 10);
    assert.deepEqual(
      picks.map((pick) => pick.key),
      [tideKey]
    );
    assert.equal(picks[0]?.code, krogerProductIdForLookup(tideUpc));
    assert.equal((await CatalogMaster.findOne({ key: gvKey }))?.matchKrogerAt?.toISOString(), now.toISOString());
    assert.equal((await CatalogMaster.findOne({ key: "auto-kroger-lookup" }))?.matchKrogerAt?.toISOString(), now.toISOString());
    const again = await nextKrogerLookups(new Date(now.getTime() + 86_400_000), 10);
    assert.equal(
      again.some((pick) => pick.key === gvKey || pick.key === "auto-kroger-lookup" || pick.key === recentKey),
      false
    );
    assert.equal(krogerLookupBlock({ name: "Great Value Black Beans", brand: "Great Value" }), "walmart-only-brand");
    assert.equal(
      krogerLookupBlock({
        name: "Walex Porta-Pak RV Waste Water Treatment",
        brand: "Walex",
        categoryPaths: ["Auto & Tires/RV/Waste Water"],
      }) !== null,
      true
    );
  });

  it("spends a stale Walmart tick on refresh before new categories", async () => {
    const now = new Date("2026-10-27T16:00:00.000Z");
    const staleRows = [
      { upc: "049000042566", name: "Coca-Cola" },
      { upc: "016000275287", name: "Cheerios" },
      { upc: "070708200500", name: "Black Beans" },
      { upc: "003063880160", name: "Pasta Sauce" },
    ];
    const keys = staleRows.map((row) => upcKey(row.upc));
    assert.ok(keys.every((key) => key));
    await CatalogMaster.deleteMany({ key: { $in: keys } });
    await CatalogOffer.deleteMany({ productKey: { $in: keys } });
    await CatalogOffer.updateMany({ status: "stale", storeName: "Walmart" }, { $set: { refreshExcluded: true } });
    await CatalogMaster.updateMany({}, { $set: { matchWalmartAt: now, matchWalmartVariant: 0 } });
    for (const [index, row] of staleRows.entries()) {
      const key = keys[index];
      assert.ok(key && walmartUpcForLookup(row.upc));
      await CatalogMaster.create({
        key,
        name: row.name,
        brand: "National",
        departmentId: "pantry",
        categoryPaths: ["Food/Pantry"],
        upc: row.upc,
        walmartItemId: `refresh-${index}`,
        lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "active",
      });
      await CatalogOffer.create({
        productKey: key,
        storeName: "Walmart",
        locationId: "",
        price: 3 + index,
        lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "stale",
      });
    }
    await IngestCheckpoint.deleteMany({ provider: "walmart" });
    await IngestCheckpoint.create({
      provider: "walmart",
      status: "running",
      checkpoint: {
        phase: "categories",
        taxonomyVersion: 8,
        categories: [{ id: "auto-clean", name: "Automotive Cleaners", path: "Auto & Tires/Automotive Cleaners", departmentId: "household" }],
        index: 0,
        nextPage: null,
        attempts: 0,
        rateStrikes: 0,
        successStreak: 0,
        matchAttempts: 0,
        matchHits: 0,
        cycleStartedAt: now.toISOString(),
      },
    });
    let refreshes = 0;
    let pages = 0;
    const config = ingestConfig();
    config.walmartDailyBudget = 20;
    config.walmartMinIntervalMs = 0;
    config.walmartLookupBatch = 1;
    config.matchLookupShare = 0.5;
    config.refreshShare = 0.3;
    config.refreshShareWalmart = 0.3;
    const slice = await stepWalmart({
      client: {
        taxonomy: async () => {
          throw new Error("taxonomy should not run while refresh can use the tick");
        },
        page: async () => {
          pages += 1;
          return { items: [], nextPageExist: false };
        },
        lookupUpcs: async (upcs: string[]) => {
          refreshes += 1;
          return {
            items: [{ itemId: 9, name: "Tide Pods", brandName: "Tide", salePrice: 11, upc: upcs[0] }],
          };
        },
      },
      maxCalls: 4,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      staleRatio: 0.351,
      now: () => now,
    });
    assert.equal(slice.calls, 4);
    assert.equal(pages, 0);
    assert.equal(refreshes, 4);
  });

  it("lets Kroger crawl again once staleness is under 30% and lookups are cached", async () => {
    const now = new Date("2026-10-27T18:00:00.000Z");
    const upc = "049000042566";
    const key = upcKey(upc);
    assert.ok(key);
    await CatalogMaster.deleteMany({ key });
    await CatalogOffer.deleteMany({ productKey: key, storeName: "Kroger" });
    await CatalogOffer.updateMany({ status: "stale", storeName: "Kroger" }, { $set: { refreshExcluded: true } });
    await CatalogMaster.updateMany({}, { $set: { matchKrogerAt: now, matchKrogerVariant: 0 } });
    await CatalogMaster.create({
      key,
      name: "Coca-Cola",
      brand: "Coca-Cola",
      departmentId: "beverages",
      upc,
      krogerProductId: krogerProductIdForLookup(upc) ?? undefined,
      walmartItemId: "coke-refresh",
      lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "active",
    });
    await CatalogOffer.create({
      productKey: key,
      storeName: "Kroger",
      locationId: "01400431",
      price: 1.2,
      lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "stale",
    });
    await IngestCheckpoint.deleteMany({ provider: "kroger" });
    await IngestCheckpoint.create({
      provider: "kroger",
      status: "running",
      checkpoint: {
        termsVersion: KROGER_TERMS_VERSION,
        phase: "queries",
        plannedZips: ["45255"],
        zipCursor: 1,
        locations: [{ zip: "45255", locationId: "01400431" }],
        locationIndex: 0,
        queryIndex: 4,
        start: 0,
        pageIndex: 0,
        attempts: 0,
        pendingZips: [],
        clientErrorStreak: 0,
        matchAttempts: 0,
        matchHits: 0,
        cycleStartedAt: now.toISOString(),
      },
    });
    const config = ingestConfig();
    config.krogerDailyBudget = 20;
    config.krogerMinIntervalMs = 0;
    config.matchLookupShare = 0.5;
    config.refreshShareKroger = 0.6;
    let pages = 0;
    let refreshes = 0;
    await stepKroger({
      client: {
        resolveLocation: async () => "01400431",
        lookupProductId: async () => {
          refreshes += 1;
          return { returned: 1, records: [] };
        },
        page: async () => {
          pages += 1;
          return { returned: 1, records: [] };
        },
      },
      maxCalls: 4,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      staleRatio: 0.22,
      now: () => now,
    });
    assert.equal(refreshes, 1);
    assert.ok(pages >= 1);
    const saved = await IngestCheckpoint.findOne({ provider: "kroger" }).lean<{ checkpoint?: { queryIndex?: number } }>();
    assert.ok((saved?.checkpoint?.queryIndex ?? 0) > 4);

    await IngestCheckpoint.deleteMany({ provider: "kroger" });
    await CatalogOffer.updateOne(
      { productKey: key, storeName: "Kroger" },
      { $set: { status: "stale", refreshExcluded: false, refreshAttemptAt: null } }
    );
    for (const extra of ["kroger-stale-2", "kroger-stale-3", "kroger-stale-4"]) {
      await CatalogMaster.deleteMany({ key: extra });
      await CatalogOffer.deleteMany({ productKey: extra });
      await CatalogMaster.create({
        key: extra,
        name: "Cheerios",
        brand: "General Mills",
        departmentId: "breakfast",
        categoryPaths: ["Food/Breakfast Foods/Cereal"],
        upc: "016000275287",
        krogerProductId: "0001600027528",
        walmartItemId: extra,
        matchKrogerAt: now,
        matchKrogerVariant: 0,
        lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "active",
      });
      await CatalogOffer.create({
        productKey: extra,
        storeName: "Kroger",
        locationId: "01400431",
        price: 3,
        lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
        status: "stale",
      });
    }
    await IngestCheckpoint.create({
      provider: "kroger",
      status: "running",
      checkpoint: {
        termsVersion: KROGER_TERMS_VERSION,
        phase: "queries",
        plannedZips: ["45255"],
        zipCursor: 1,
        locations: [{ zip: "45255", locationId: "01400431" }],
        locationIndex: 0,
        queryIndex: 4,
        start: 0,
        pageIndex: 0,
        attempts: 0,
        pendingZips: [],
        clientErrorStreak: 0,
        matchAttempts: 0,
        matchHits: 0,
        cycleStartedAt: now.toISOString(),
      },
    });
    let stalePages = 0;
    let staleRefreshes = 0;
    await stepKroger({
      client: {
        resolveLocation: async () => "01400431",
        lookupProductId: async () => {
          staleRefreshes += 1;
          return { returned: 0, records: [] };
        },
        page: async () => {
          stalePages += 1;
          return { returned: 1, records: [] };
        },
      },
      maxCalls: 4,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      staleRatio: 0.351,
      now: () => now,
    });
    assert.equal(stalePages, 0);
    assert.equal(staleRefreshes, 4);
  });

  it("raises the local Kroger match rate by skipping private label, auto, and cached misses", () => {
    type Sample = {
      name: string;
      brand: string;
      upc: string;
      categoryPaths?: string[];
      triedDaysAgo?: number;
      stuckVariant?: boolean;
      carriesAtKroger: boolean;
    };
    const national = (name: string, brand: string, upc: string): Sample => ({
      name,
      brand,
      upc,
      categoryPaths: ["Food/Pantry"],
      carriesAtKroger: true,
    });
    const rows: Sample[] = [
      national("Coca-Cola", "Coca-Cola", "049000042566"),
      national("Cheerios", "General Mills", "016000275287"),
      ...Array.from({ length: 40 }, (_, index) => ({
        name: `Great Value Item ${index}`,
        brand: "Great Value",
        upc: "070708200500",
        categoryPaths: ["Food/Pantry/Canned"],
        carriesAtKroger: false,
      })),
      ...Array.from({ length: 40 }, (_, index) => ({
        name: index % 2 === 0 ? "Chemical Guys Automotive Cleaner" : "Walex RV Waste Water Treatment",
        brand: index % 2 === 0 ? "Chemical Guys" : "Walex",
        upc: "003063880160",
        categoryPaths: index % 2 === 0 ? ["Auto & Tires/Automotive Chemicals/Cleaners"] : ["Auto & Tires/RV/Waste Water"],
        carriesAtKroger: false,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        name: `Cached miss ${index}`,
        brand: "Gunk",
        upc: "073214835404",
        categoryPaths: ["Auto & Tires/Degreasers"],
        triedDaysAgo: 1,
        stuckVariant: true,
        carriesAtKroger: false,
      })),
    ];
    const attempt = (row: Sample, policy: "before" | "after") => {
      const recent = row.triedDaysAgo !== undefined && row.triedDaysAgo < 14;
      if (policy === "before") {
        if (recent && !row.stuckVariant) {
          return false;
        }
      } else if (recent) {
        return false;
      }
      if (policy === "after" && krogerLookupBlock(row)) {
        return false;
      }
      const code = krogerProductIdForLookup(row.upc);
      return Boolean(code && code.length === 13);
    };
    const score = (policy: "before" | "after") => {
      let attempts = 0;
      let hits = 0;
      for (const row of rows) {
        if (!attempt(row, policy)) {
          continue;
        }
        attempts += 1;
        if (row.carriesAtKroger) {
          hits += 1;
        }
      }
      return { attempts, hits, rate: Math.round((hits / attempts) * 1000) / 1000 };
    };
    const before = score("before");
    const after = score("after");
    assert.equal(before.attempts, 92);
    assert.equal(before.hits, 2);
    assert.equal(before.rate, 0.022);
    assert.equal(after.attempts, 2);
    assert.equal(after.hits, 2);
    assert.equal(after.rate, 1);
    assert.equal(krogerProductIdForLookup("049000042566"), "0004900004256");
    assert.equal(krogerProductIdForLookup("0049000042566"), "0004900004256");
    assert.equal(krogerProductIdForLookup("00049000042566"), "0004900004256");
    assert.equal(krogerProductIdForLookup("49000042566"), "0004900004256");
    assert.equal(krogerProductIdForLookup("070708200500"), "0007070820050");
  });
});
