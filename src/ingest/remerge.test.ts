import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { browseCatalog } from "../catalog/service";
import { gtinJoinKey } from "../catalog/gtin";
import { krogerProductIdForLookup } from "../catalog/normalize";
import { optimizeGroceryList } from "../optimizeGroceryList";
import type { CatalogProduct } from "../optimizeGroceryList";
import type { RawCatalogRecord } from "../catalog/types";
import { MemoryBudgetStore } from "./budget";
import { ingestConfig } from "./config";
import { KROGER_TERMS_VERSION } from "./krogerTerms";
import { upsertCatalogRecords } from "./upsert";
import { CatalogMaster, CatalogMatchDay, CatalogOffer, IngestCheckpoint, IngestLock } from "./models";
import { RemergeBusyError, remergeGtinCatalog } from "./remerge";
import { finishLookups, matchProgress } from "./crossLookup";
import { stepKroger } from "./runner";

const cheeriosWalmart = "016000124790";
const cheeriosKroger = "0001600012479";
const milkWalmart = "049000042566";
const milkKroger = "0004900004256";

describe("GTIN remerge and both-store prices", () => {
  let memory: MongoMemoryServer;

  before(async () => {
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
    process.env.CATALOG_DB_FIRST = "1";
    process.env.CATALOG_MAX_PRODUCTS = "1000";
    process.env.CATALOG_MAX_OFFERS = "5000";
  });

  after(async () => {
    await mongoose.disconnect();
    await memory.stop();
  });

  it("stores a Walmart UPC and the Kroger no-check id on one product", async () => {
    await upsertCatalogRecords([
      {
        name: "Honey Nut Cheerios",
        brand: "General Mills",
        storeName: "Walmart",
        price: 4.98,
        upc: cheeriosWalmart,
        productId: "944068996",
        retailerItemId: "944068996",
        priceSource: "live",
        departmentId: "breakfast",
        size: "10.8 oz",
        locationId: "45103",
      },
      {
        name: "Honey Nut Cheerios Cereal",
        brand: "General Mills",
        storeName: "Kroger",
        price: 3.99,
        upc: cheeriosKroger,
        productId: cheeriosKroger,
        priceSource: "live",
        departmentId: "breakfast",
        size: "10.8 oz",
        locationId: "01400902",
      },
    ]);
    assert.equal(await CatalogMaster.countDocuments({}), 1);
    const master = await CatalogMaster.findOne().lean<{ key: string; krogerProductId?: string; walmartItemId?: string }>();
    assert.equal(master?.walmartItemId, "944068996");
    assert.ok(master?.krogerProductId);
    const page = await browseCatalog({ query: "cheerios", zipCode: "45103", limit: 8 });
    const item = page.items.find((row) => /cheerios/i.test(row.name));
    assert.ok(item);
    const stores = new Set(item?.offers.map((offer) => offer.storeName));
    assert.equal(stores.has("Kroger"), true);
    assert.equal(stores.has("Walmart"), true);
    const kroger = item?.offers.find((offer) => offer.storeName === "Kroger");
    assert.equal(kroger?.price, 3.99);
  });

  it("shows both-store savings for a mixed list at 45103", async () => {
    await upsertCatalogRecords([
      {
        name: "Coca-Cola Classic 12 Pack",
        brand: "Coca-Cola",
        storeName: "Walmart",
        price: 7.48,
        upc: milkWalmart,
        productId: "157885053",
        retailerItemId: "157885053",
        priceSource: "live",
        departmentId: "beverages",
        size: "12 pk",
      },
      {
        name: "Coca-Cola Classic 12 pk",
        brand: "Coca-Cola",
        storeName: "Kroger",
        price: 6.48,
        upc: milkKroger,
        productId: milkKroger,
        priceSource: "live",
        departmentId: "beverages",
        size: "12 pk",
      },
    ]);
    const cokeOffers = await CatalogOffer.find({ storeName: { $in: ["Kroger", "Walmart"] } }).lean<Array<{ storeName: string; price: number; productKey: string }>>();
    const cokeKey = cokeOffers.find((offer) => offer.storeName === "Walmart" && offer.price === 7.48)?.productKey;
    assert.ok(cokeKey);
    assert.equal(cokeOffers.some((offer) => offer.productKey === cokeKey && offer.storeName === "Kroger" && offer.price === 6.48), true);
    const priced = await browseCatalog({ query: "cheerios", zipCode: "45103", limit: 8 });
    assert.equal(priced.items.some((item) => item.offers.some((offer) => offer.storeName === "Kroger")), true);
    const products: CatalogProduct[] = [
      { name: "Honey Nut Cheerios", brand: "General Mills", storeName: "Walmart", price: 3.49, unit: "each", normalizedUnit: "each", upc: cheeriosWalmart },
      { name: "Honey Nut Cheerios", brand: "General Mills", storeName: "Kroger", price: 4.99, unit: "each", normalizedUnit: "each", upc: cheeriosKroger },
      { name: "Coca-Cola Classic 12 Pack", brand: "Coca-Cola", storeName: "Walmart", price: 8.48, unit: "each", normalizedUnit: "each", upc: milkWalmart },
      { name: "Coca-Cola Classic 12 Pack", brand: "Coca-Cola", storeName: "Kroger", price: 5.99, unit: "each", normalizedUnit: "each", upc: milkKroger },
    ];
    const plan = optimizeGroceryList(["Honey Nut Cheerios", "Coca-Cola Classic 12 Pack"], ["Kroger", "Walmart"], products, "split");
    const single = optimizeGroceryList(["Honey Nut Cheerios", "Coca-Cola Classic 12 Pack"], ["Kroger", "Walmart"], products, "single");
    assert.equal(plan.stores.length >= 1, true);
    assert.ok(plan.total < single.total);
    assert.equal(plan.stores.some((store) => store.storeName === "Kroger"), true);
    assert.equal(plan.stores.some((store) => store.storeName === "Walmart"), true);
    const finished = await finishLookups(
      "kroger",
      [{ key: "160001247", name: "Honey Nut Cheerios", code: cheeriosKroger, codes: [cheeriosKroger], variantIndex: 0, priority: "staple", upc: cheeriosWalmart, departmentId: "breakfast" }],
      new Date()
    );
    assert.equal(finished.hits, 1);
  });

  it("dry-runs a merge of split masters and applies it once", async () => {
    await CatalogMaster.create([
      {
        key: "160001247",
        upc: cheeriosKroger,
        name: "Honey Nut Cheerios",
        brand: "General Mills",
        departmentId: "breakfast",
        krogerProductId: cheeriosKroger,
        lastSeenAt: new Date(),
      },
      {
        key: "orphan-coke",
        upc: milkWalmart,
        name: "Coca-Cola",
        brand: "Coca-Cola",
        departmentId: "beverages",
        walmartItemId: "99",
        lastSeenAt: new Date(),
      },
    ]);
    const dry = await remergeGtinCatalog({ apply: false });
    assert.equal(dry.dryRun, true);
    assert.ok(dry.mergeGroups >= 1 || dry.rekey >= 1);
    const applied = await remergeGtinCatalog({ apply: true });
    assert.equal(applied.dryRun, false);
    const again = await remergeGtinCatalog({ apply: false });
    assert.equal(again.mergeGroups, 0);
    assert.equal(again.rekey, 0);
  });

  it("allows one apply at a time, cools down, throttles batches, and keeps GET dry", async () => {
    await IngestLock.deleteMany({ _id: "gtin-remerge" });
    await CatalogMaster.deleteMany({});
    const now = new Date("2026-04-02T12:00:00.000Z");
    await CatalogMaster.create([
      { key: "batch-a", name: "A", brand: "A", departmentId: "pantry", upc: "111", lastSeenAt: now },
      { key: "batch-b", name: "B", brand: "B", departmentId: "pantry", upc: "222", lastSeenAt: now },
      { key: "batch-c", name: "C", brand: "C", departmentId: "pantry", upc: "333", lastSeenAt: now },
    ]);
    const pauses: number[] = [];
    await remergeGtinCatalog({
      apply: true,
      pauseMs: 0,
      cooldownMs: 0,
      batchSize: 1,
      now,
      pause: async (ms) => {
        pauses.push(ms);
      },
    });
    assert.ok(pauses.length >= 2);

    await IngestLock.deleteMany({ _id: "gtin-remerge" });
    const liveNow = new Date();
    let releaseHold: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const running = remergeGtinCatalog({
      apply: true,
      pauseMs: 0,
      cooldownMs: 60_000,
      now: liveNow,
      hold: () => held,
    });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const lock = await IngestLock.findById("gtin-remerge").lean<{ owner?: string } | null>();
      if (lock?.owner && lock.owner !== "cooldown") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await assert.rejects(remergeGtinCatalog({ apply: true, pauseMs: 0, now: liveNow }), RemergeBusyError);
    const dryWhileBusy = await remergeGtinCatalog({ apply: false });
    assert.equal(dryWhileBusy.dryRun, true);
    process.env.ADMIN_TOKEN = "secret-token";
    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { authorization: "Bearer secret-token", "content-type": "application/json" };
    try {
      const blocked = await fetch(`${origin}/api/admin/catalog/remerge`, {
        method: "POST",
        headers,
        body: JSON.stringify({ apply: true, confirm: "remerge-gtin" }),
      });
      assert.equal(blocked.status, 409);
      const peeked = await fetch(`${origin}/api/admin/catalog/remerge`, { headers });
      assert.equal(peeked.status, 200);
      const peekedBody = (await peeked.json()) as { dryRun?: boolean };
      assert.equal(peekedBody.dryRun, true);
      releaseHold();
      await running;
      const cooled = await fetch(`${origin}/api/admin/catalog/remerge`, {
        method: "POST",
        headers,
        body: JSON.stringify({ apply: true, confirm: "remerge-gtin" }),
      });
      assert.equal(cooled.status, 409);
      const cooledBody = (await cooled.json()) as { reason?: string };
      assert.equal(cooledBody.reason, "cooldown");
    } finally {
      releaseHold();
      await running.catch(() => undefined);
      server.close();
      delete process.env.ADMIN_TOKEN;
    }
  });

  it("counts a mixed Kroger day when the hit is on the other GTIN key", async () => {
    const now = new Date("2026-04-03T15:00:00.000Z");
    const day = "2026-04-03";
    await CatalogMaster.deleteMany({});
    await CatalogOffer.deleteMany({});
    await CatalogMatchDay.deleteMany({ day });
    await IngestCheckpoint.deleteMany({ provider: "kroger" });
    const chobaniUpc = "894700010144";
    const chobaniId = "0089470001014";
    const cokeUpc = "049000042566";
    const cheeriosId = krogerProductIdForLookup(cheeriosWalmart) ?? "";
    const cokeId = krogerProductIdForLookup(cokeUpc) ?? "";
    assert.equal(cheeriosId, cheeriosKroger);
    assert.equal(gtinJoinKey(chobaniId, { source: "kroger-product-id" }), gtinJoinKey(chobaniUpc));
    await CatalogMaster.create([
      {
        key: "160001247",
        upc: cheeriosWalmart,
        name: "Honey Nut Cheerios",
        brand: "General Mills",
        departmentId: "breakfast",
        walmartItemId: "944068996",
        lastSeenAt: now,
      },
      {
        key: "8947000101",
        upc: chobaniUpc,
        name: "Chobani Vanilla",
        brand: "Chobani",
        departmentId: "dairy-eggs",
        walmartItemId: "104501",
        lastSeenAt: now,
      },
      {
        key: "4900004256",
        upc: cokeUpc,
        name: "Coca-Cola",
        brand: "Coca-Cola",
        departmentId: "pantry",
        walmartItemId: "5522",
        lastSeenAt: now,
      },
    ]);
    await IngestCheckpoint.create({
      provider: "kroger",
      status: "running",
      checkpoint: {
        termsVersion: KROGER_TERMS_VERSION,
        phase: "queries",
        plannedZips: [],
        pendingZips: [],
        locations: [],
        zipCursor: 0,
        locationIndex: 0,
        queryIndex: 0,
        start: 0,
        pageIndex: 0,
        attempts: 0,
        serverStrikes: 0,
        matchAttempts: 0,
        matchHits: 0,
        cycleStartedAt: now.toISOString(),
      },
    });
    const config = ingestConfig();
    config.matchLookupShare = 1;
    config.refreshShareKroger = 0;
    config.krogerMinIntervalMs = 0;
    config.krogerDailyBudget = 20;
    config.locationDailyBudget = 5;
    const krogerOffer = (name: string, productId: string, price: number): RawCatalogRecord => ({
      name,
      brand: name.split(" ")[0] ?? "Test",
      storeName: "Kroger",
      price,
      productId,
      upc: productId,
      priceSource: "live",
    });
    const serverError = Object.assign(new Error("unavailable (504)"), { status: 504 });
    const client = {
      resolveLocation: async () => null,
      page: async () => ({ records: [], returned: 0 }),
      lookupProductId: async (productId: string) => {
        if (productId === cokeId) throw serverError;
        if (productId === chobaniId) return { records: [], returned: 0 };
        if (productId === cheeriosId) return { records: [krogerOffer("Honey Nut Cheerios", cheeriosId, 3.99)], returned: 1 };
        return { records: [], returned: 0 };
      },
      lookupTerm: async (term: string) => {
        if (term.toLowerCase().includes("chobani")) {
          return { records: [krogerOffer("Chobani Vanilla", chobaniId, 1.19)], returned: 1 };
        }
        return { records: [], returned: 0 };
      },
    };
    const first = await stepKroger({
      client,
      maxCalls: 8,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => now,
      staleRatio: 0,
    });
    assert.equal(first.paused, "server");
    const cheerios = await CatalogMaster.findOne({ key: gtinJoinKey(cheeriosWalmart) ?? "" }).lean<{ krogerProductId?: string } | null>();
    const yogurt = await CatalogMaster.findOne({ key: gtinJoinKey(chobaniUpc) ?? "" }).lean<{ krogerProductId?: string } | null>();
    assert.equal(cheerios?.krogerProductId, cheeriosId);
    assert.equal(yogurt?.krogerProductId, chobaniId);
    const held = await CatalogMaster.findOne({ key: "4900004256" }).lean<{ matchKrogerAt?: Date; matchKrogerHoldUntil?: Date } | null>();
    assert.equal(held?.matchKrogerAt, undefined);
    assert.ok(held?.matchKrogerHoldUntil);

    await CatalogMaster.create({
      key: "01200001331",
      upc: "012000013312",
      name: "Pepsi",
      brand: "Pepsi",
      departmentId: "beverages",
      walmartItemId: "77",
      lastSeenAt: now,
    });
    const checkpoint = await IngestCheckpoint.findOne({ provider: "kroger" }).lean<{ checkpoint?: { serverCooldownUntil?: string } } | null>();
    const later = new Date(Date.parse(checkpoint?.checkpoint?.serverCooldownUntil ?? now.toISOString()) + 1000);
    config.krogerDailyBudget = 0;
    const second = await stepKroger({
      client,
      maxCalls: 2,
      store: new MemoryBudgetStore(),
      sleep: async () => undefined,
      config,
      now: () => later,
      staleRatio: 0,
    });
    assert.equal(second.paused, "budget");
    const progress = await matchProgress(later);
    assert.equal(progress.day, day);
    assert.equal(progress.hitRate.krogerAttempts, 2);
    assert.equal(progress.hitRate.krogerHits, 2);
    assert.equal(progress.hitRate.kroger, 1);
    assert.equal(progress.hitRate.krogerByDepartment?.breakfast?.attempts, 1);
    assert.equal(progress.hitRate.krogerByDepartment?.breakfast?.hits, 1);
    assert.equal(progress.hitRate.krogerByDepartment?.["dairy-eggs"]?.attempts, 1);
    assert.equal(progress.hitRate.krogerByDepartment?.["dairy-eggs"]?.hits, 1);
    assert.equal(progress.hitRate.krogerByDepartment?.pantry, undefined);
    assert.equal(progress.hitRate.krogerByDepartment?.beverages, undefined);
  });
});
