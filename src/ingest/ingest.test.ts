import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { browseCatalog } from "../catalog/service";
import { upcKey } from "../catalog/normalize";
import type { RawCatalogRecord } from "../catalog/types";
import { MemoryBudgetStore, MongoBudgetStore } from "./budget";
import { ingestConfig } from "./config";
import { KROGER_TERMS_VERSION } from "./krogerTerms";
import { dropShadowLocalKeys, resetRunCounters } from "./maintenance";
import { CatalogMaster, CatalogOffer, IngestBudget, IngestCheckpoint, IngestLock, ShopperZip } from "./models";
import { acquireIngestLock, noteShopperZip, releaseIngestLock, runDemoIngest, stepKroger, stepWalmart } from "./runner";
import { catalogStatus } from "./status";
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
          (error as Error & { status: number }).status = 400;
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
      recentErrors?: Array<{ provider?: string; status?: number; params?: { term?: string; start?: number; locationId?: string; action?: string } }>;
      checkpoint?: { locationIndex?: number; phase?: string };
    }>();
    const logged = saved?.recentErrors?.find((entry) => entry.status === 400);
    assert.equal(logged?.provider, "kroger");
    assert.equal(logged?.params?.term, "bananas");
    assert.equal(logged?.params?.start, 50);
    assert.equal(logged?.params?.locationId, "01400999");
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
    const body = (await ok.json()) as {
      counts: { products: number };
      budget: { walmart: { limit: number; minIntervalMs: number } };
      shopperZips: Array<{ zip: string; hits: number }>;
      seedZips: string[];
    };
    assert.ok(body.counts.products > 0);
    assert.equal(body.budget.walmart.limit, 1500);
    assert.equal(body.budget.walmart.minIntervalMs, 5000);
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
});
