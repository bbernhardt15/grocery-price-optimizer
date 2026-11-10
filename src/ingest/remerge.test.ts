import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { browseCatalog } from "../catalog/service";
import { optimizeGroceryList } from "../optimizeGroceryList";
import type { CatalogProduct } from "../optimizeGroceryList";
import { upsertCatalogRecords } from "./upsert";
import { CatalogMaster, CatalogOffer } from "./models";
import { remergeGtinCatalog } from "./remerge";
import { finishLookups } from "./crossLookup";

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
});
