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
import { MemoryBudgetStore } from "./budget";
import { ingestConfig } from "./config";
import { CatalogMaster, CatalogOffer, IngestCheckpoint, IngestLock } from "./models";
import { acquireIngestLock, releaseIngestLock, runDemoIngest, stepKroger, stepWalmart } from "./runner";
import { markStaleCatalog, upsertCatalogRecords } from "./upsert";

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
    const sleep = async () => undefined;
    const first = await stepWalmart({ client, maxCalls: 2, store, sleep, config });
    assert.equal(first.calls, 2);
    const saved = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{
      checkpoint?: { nextPage?: string; attempts?: number };
    }>();
    assert.equal(saved?.checkpoint?.nextPage, "cursor-2");
    const blocked = await stepWalmart({ client, maxCalls: 1, store, sleep, config });
    assert.equal(blocked.paused, "rate");
    const held = await IngestCheckpoint.findOne({ provider: "walmart" }).lean<{
      checkpoint?: { nextPage?: string; attempts?: number };
    }>();
    assert.equal(held?.checkpoint?.nextPage, "cursor-2");
    assert.equal(held?.checkpoint?.attempts, 1);
    await stepWalmart({ client, maxCalls: 1, store, sleep, config });
    assert.equal(await CatalogMaster.countDocuments({ key: upcKey("00055566677795") }), 1);
    assert.equal(await CatalogMaster.countDocuments({ upc: /55566677788/ }), 1);
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
    delete process.env.CATALOG_SEED_ZIPS;
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
    const body = (await ok.json()) as { counts: { products: number }; budget: { walmart: { limit: number } } };
    assert.ok(body.counts.products > 0);
    assert.equal(body.budget.walmart.limit, 1500);
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
});
