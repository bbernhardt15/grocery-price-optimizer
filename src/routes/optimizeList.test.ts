import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { Product } from "../models/Product";
import { mockProducts } from "../seed";
import { fetchMatchingProducts } from "../fetchMatchingProducts";
import { krogerService } from "../krogerService";
import { walmartPricingProvider } from "../pricing/walmartProvider";
import { targetPricingProvider } from "../pricing/targetProvider";
import { flippProviderForStore, type FlippDealsProvider } from "../pricing/flipp/flippProvider";

describe("POST /api/optimize-list", () => {
  let memory: MongoMemoryServer;
  let server: http.Server;
  let origin: string;
  const previousEnv = {
    KROGER_CLIENT_ID: process.env.KROGER_CLIENT_ID,
    KROGER_CLIENT_SECRET: process.env.KROGER_CLIENT_SECRET,
    WALMART_CONSUMER_ID: process.env.WALMART_CONSUMER_ID,
    WALMART_PRIVATE_KEY: process.env.WALMART_PRIVATE_KEY,
    WALMART_PUBLISHER_ID: process.env.WALMART_PUBLISHER_ID,
    TARGET_PARTNER_BASE_URL: process.env.TARGET_PARTNER_BASE_URL,
    TARGET_PARTNER_API_KEY: process.env.TARGET_PARTNER_API_KEY,
    FLIPP_ENABLED: process.env.FLIPP_ENABLED,
    FLIPP_ACCESS_TOKEN: process.env.FLIPP_ACCESS_TOKEN,
  };

  function clearPricingEnv(): void {
    delete process.env.KROGER_CLIENT_ID;
    delete process.env.KROGER_CLIENT_SECRET;
    delete process.env.WALMART_CONSUMER_ID;
    delete process.env.WALMART_PRIVATE_KEY;
    delete process.env.WALMART_PUBLISHER_ID;
    delete process.env.TARGET_PARTNER_BASE_URL;
    delete process.env.TARGET_PARTNER_API_KEY;
    delete process.env.FLIPP_ENABLED;
    delete process.env.FLIPP_ACCESS_TOKEN;
  }

  function setKrogerCreds(): void {
    process.env.KROGER_CLIENT_ID = "test-client";
    process.env.KROGER_CLIENT_SECRET = "test-secret";
  }

  before(async () => {
    clearPricingEnv();
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
    await Product.insertMany(
      mockProducts.map((product) => ({
        ...product,
        lastUpdated: new Date(),
        updatedAt: new Date(),
      }))
    );

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoose.disconnect();
    await memory.stop();
    clearPricingEnv();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  async function optimize(body: unknown): Promise<{ status: number; json: unknown }> {
    const response = await fetch(`${origin}/api/optimize-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  }

  it("regex-matches each grocery string and returns lists grouped by cheapest store", async () => {
    const { status, json } = await optimize({
      groceryList: ["Gallon of Milk", "Loaf of Bread", "Dozen Eggs"],
      stores: ["Walmart", "Target", "Kroger"],
    });

    assert.equal(status, 200);
    const body = json as {
      stores: Array<{ storeName: string; items: Array<{ query: string; price: number }>; subtotal: number }>;
      unavailable: string[];
      total: number;
    };

    const byStore = Object.fromEntries(
      body.stores.map((store) => [store.storeName, store])
    );

    assert.equal(byStore.Kroger.items[0].query, "Gallon of Milk");
    assert.equal(byStore.Kroger.items[0].price, 2.89);

    assert.equal(byStore.Walmart.items[0].query, "Loaf of Bread");
    assert.equal(byStore.Walmart.items[0].price, 1.28);

    assert.equal(byStore.Target.items[0].query, "Dozen Eggs");
    assert.equal(byStore.Target.items[0].price, 1.99);

    assert.deepEqual(body.unavailable, []);
    assert.equal(body.total, 6.16);
  });

  it("matches partial strings such as milk against Gallon of Milk", async () => {
    const { status, json } = await optimize({
      groceryList: ["milk"],
      stores: ["Kroger"],
    });

    assert.equal(status, 200);
    const body = json as {
      stores: Array<{ storeName: string; items: Array<{ name: string; price: number }> }>;
    };
    assert.equal(body.stores[0].storeName, "Kroger");
    assert.equal(body.stores[0].items[0].name, "Gallon of Milk");
    assert.equal(body.stores[0].items[0].price, 2.89);
  });

  it("accepts a raw string array as the grocery list", async () => {
    const { status, json } = await optimize(["Dozen Eggs"]);
    assert.equal(status, 200);
    const body = json as {
      stores: Array<{ storeName: string; items: Array<{ price: number }> }>;
    };
    assert.equal(body.stores[0].storeName, "Target");
    assert.equal(body.stores[0].items[0].price, 1.99);
  });

  it("returns regex matches sorted by price so cheaper milk is picked first", async () => {
    await Product.create({
      name: "Whole Milk",
      brand: "Expensive Farms",
      storeName: "Kroger",
      price: 4.99,
      unit: "gal",
      normalizedUnit: "gal",
      lastUpdated: new Date(),
    });

    const matches = await fetchMatchingProducts(["milk"], ["Kroger"]);
    assert.ok(matches.length >= 2);
    assert.deepEqual(
      matches.map((product) => product.price),
      [...matches.map((product) => product.price)].sort((a, b) => a - b)
    );
    assert.equal(matches[0].name, "Gallon of Milk");
    assert.equal(matches[0].price, 2.89);

    const { status, json } = await optimize({
      groceryList: ["milk"],
      stores: ["Kroger"],
    });
    assert.equal(status, 200);
    const body = json as {
      stores: Array<{ items: Array<{ name: string; price: number }> }>;
    };
    assert.equal(body.stores[0].items[0].name, "Gallon of Milk");
    assert.equal(body.stores[0].items[0].price, 2.89);
  });

  it("multiplies matched prices by parsed quantities in the JSON response", async () => {
    const { status, json } = await optimize({
      groceryList: ["2 milk", "Bread x2"],
      stores: ["Walmart", "Target", "Kroger"],
    });

    assert.equal(status, 200);
    const body = json as {
      stores: Array<{
        storeName: string;
        items: Array<{ name: string; quantity: number; price: number; itemTotal: number }>;
        subtotal: number;
      }>;
      total: number;
    };
    const byStore = Object.fromEntries(
      body.stores.map((store) => [store.storeName, store])
    );

    assert.equal(byStore.Kroger.items[0].name, "Gallon of Milk");
    assert.equal(byStore.Kroger.items[0].quantity, 2);
    assert.equal(byStore.Kroger.items[0].price, 2.89);
    assert.equal(byStore.Kroger.items[0].itemTotal, 5.78);

    assert.equal(byStore.Walmart.items[0].name, "Loaf of Bread");
    assert.equal(byStore.Walmart.items[0].quantity, 2);
    assert.equal(byStore.Walmart.items[0].itemTotal, 2.56);

    assert.equal(body.total, 8.34);
  });

  it("looks up the nearest Kroger from zipCode and only prices that store", async () => {
    const originalLookup = krogerService.getClosestStoreLocation.bind(krogerService);
    krogerService.getClosestStoreLocation = async (zipCode: string) => {
      assert.equal(zipCode, "45202");
      return "01400441";
    };

    try {
      await Product.create({
        name: "Gallon of Milk",
        brand: "Faraway Farms",
        storeName: "Kroger",
        locationId: "99999999",
        price: 0.01,
        unit: "gal",
        normalizedUnit: "gal",
        lastUpdated: new Date(),
      });

      const { status, json } = await optimize({
        groceryList: ["milk"],
        zipCode: "45202",
      });

      assert.equal(status, 200);
      const body = json as {
        stores: Array<{ storeName: string; items: Array<{ name: string; price: number }> }>;
        zipCode?: string;
        locationId?: string;
      };

      assert.equal(body.zipCode, "45202");
      assert.equal(body.locationId, "01400441");
      assert.equal(body.stores.length, 1);
      assert.equal(body.stores[0].storeName, "Kroger");
      assert.equal(body.stores[0].items[0].name, "Gallon of Milk");
      assert.equal(body.stores[0].items[0].price, 2.89);
    } finally {
      krogerService.getClosestStoreLocation = originalLookup;
      await Product.deleteMany({ brand: "Faraway Farms" });
    }
  });

  it("still splits the trip across Walmart and Target when a ZIP selects a Kroger store", async () => {
    const originalLookup = krogerService.getClosestStoreLocation.bind(krogerService);
    krogerService.getClosestStoreLocation = async () => "01400441";

    try {
      const { status, json } = await optimize({
        groceryList: ["Gallon of Milk", "Loaf of Bread", "Dozen Eggs"],
        zipCode: "45202",
      });
      assert.equal(status, 200);
      const body = json as {
        stores: Array<{ storeName: string; handoff: { action: { type: string } } }>;
        tripPlan: { summary: string };
        locationId?: string;
      };
      assert.equal(body.locationId, "01400441");
      const names = body.stores.map((store) => store.storeName).sort();
      assert.deepEqual(names, ["Kroger", "Target", "Walmart"]);
      assert.match(body.tripPlan.summary, /Kroger/);
      assert.match(body.tripPlan.summary, /Walmart/);
      assert.match(body.tripPlan.summary, /Target/);
    } finally {
      krogerService.getClosestStoreLocation = originalLookup;
    }
  });

  it("rejects an empty zipCode string", async () => {
    const { status, json } = await optimize({
      groceryList: ["milk"],
      zipCode: "  ",
    });
    assert.equal(status, 400);
    const body = json as { error: string };
    assert.match(body.error, /zipCode/i);
  });

  it("skips the live Products API when matching live rows are fresher than 24 hours", async () => {
    setKrogerCreds();
    let liveCalls = 0;
    const originalSearch = krogerService.searchProducts.bind(krogerService);
    krogerService.searchProducts = async () => {
      liveCalls += 1;
      return [];
    };

    try {
      await Product.create({
        name: "Cached Live Milk",
        brand: "Kroger",
        storeName: "Kroger",
        price: 2.51,
        unit: "gal",
        normalizedUnit: "gal",
        priceSource: "live",
        lastUpdated: new Date(),
        updatedAt: new Date(),
      });

      const { status, json } = await optimize({
        groceryList: ["Cached Live Milk"],
        stores: ["Kroger"],
      });
      assert.equal(status, 200);
      const body = json as {
        stores: Array<{
          items: Array<{ name: string; price: number; priceSource?: string }>;
          pricing?: { source: string; label: string };
        }>;
      };
      assert.equal(body.stores[0].items[0].name, "Cached Live Milk");
      assert.equal(body.stores[0].items[0].price, 2.51);
      assert.equal(body.stores[0].items[0].priceSource, "cached_live");
      assert.equal(body.stores[0].pricing?.source, "cached_live");
      assert.equal(liveCalls, 0);
    } finally {
      krogerService.searchProducts = originalSearch;
      delete process.env.KROGER_CLIENT_ID;
      delete process.env.KROGER_CLIENT_SECRET;
      await Product.deleteMany({ name: "Cached Live Milk" });
    }
  });

  it("uses the seed catalog for Kroger when client-credentials are missing", async () => {
    let liveCalls = 0;
    const originalSearch = krogerService.searchProducts.bind(krogerService);
    krogerService.searchProducts = async () => {
      liveCalls += 1;
      return [];
    };

    try {
      const { status, json } = await optimize({
        groceryList: ["milk"],
        stores: ["Kroger"],
      });
      assert.equal(status, 200);
      const body = json as {
        stores: Array<{
          items: Array<{ name: string; price: number; priceSource?: string }>;
          pricing?: { source: string; label: string };
        }>;
        pricingByStore: Array<{ storeName: string; source: string; label: string }>;
      };
      assert.equal(body.stores[0].items[0].name, "Gallon of Milk");
      assert.equal(body.stores[0].items[0].price, 2.89);
      assert.equal(body.stores[0].items[0].priceSource, "seed");
      assert.equal(body.stores[0].pricing?.label, "Demo catalog");
      assert.equal(liveCalls, 0);
    } finally {
      krogerService.searchProducts = originalSearch;
    }
  });

  it("on a cache miss, fetches live Kroger prices and upserts them before optimizing", async () => {
    setKrogerCreds();
    const originalSearch = krogerService.searchProducts.bind(krogerService);
    const originalLookup = krogerService.getClosestStoreLocation.bind(krogerService);
    krogerService.getClosestStoreLocation = async () => "01400441";
    krogerService.searchProducts = async (term: string, locationId?: string) => {
      assert.equal(term, "quinoa");
      assert.equal(locationId, "01400441");
      return [
        {
          name: "Organic Quinoa",
          brand: "Simple Truth",
          storeName: "Kroger",
          locationId,
          price: 4.5,
          unit: "oz",
          normalizedUnit: "oz",
        },
      ];
    };

    try {
      const { status, json } = await optimize({
        groceryList: ["quinoa"],
        zipCode: "45202",
      });
      assert.equal(status, 200);
      const body = json as {
        stores: Array<{ storeName: string; items: Array<{ name: string; price: number }> }>;
        locationId?: string;
      };
      assert.equal(body.locationId, "01400441");
      assert.equal(body.stores[0].storeName, "Kroger");
      assert.equal(body.stores[0].items[0].name, "Organic Quinoa");
      assert.equal(body.stores[0].items[0].price, 4.5);

      const saved = await Product.findOne({ name: "Organic Quinoa" }).lean();
      assert.ok(saved);
      assert.equal(saved?.price, 4.5);
      assert.equal(saved?.priceSource, "live");
      assert.ok(saved?.updatedAt);
      assert.ok(Date.now() - new Date(saved.updatedAt).getTime() < 60_000);
    } finally {
      krogerService.searchProducts = originalSearch;
      krogerService.getClosestStoreLocation = originalLookup;
      delete process.env.KROGER_CLIENT_ID;
      delete process.env.KROGER_CLIENT_SECRET;
    }
  });

  it("treats rows older than 24 hours as a cache miss and refreshes them", async () => {
    setKrogerCreds();
    const originalSearch = krogerService.searchProducts.bind(krogerService);
    const originalLookup = krogerService.getClosestStoreLocation.bind(krogerService);
    krogerService.getClosestStoreLocation = async () => "01400441";
    krogerService.searchProducts = async () => [
      {
        name: "Smoked Paprika",
        brand: "Kroger",
        storeName: "Kroger",
        locationId: "01400441",
        price: 1.25,
        unit: "oz",
        normalizedUnit: "oz",
      },
    ];

    try {
      const created = await Product.create({
        name: "Smoked Paprika",
        brand: "Kroger",
        storeName: "Kroger",
        locationId: "01400441",
        price: 9.99,
        unit: "oz",
        normalizedUnit: "oz",
        lastUpdated: new Date(Date.now() - 25 * 60 * 60 * 1000),
        priceSource: "live",
      });
      await Product.updateOne(
        { _id: created._id },
        { $set: { updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } },
        { timestamps: false }
      );

      const { status, json } = await optimize({
        groceryList: ["paprika"],
        zipCode: "45202",
      });
      assert.equal(status, 200);
      const body = json as {
        stores: Array<{ items: Array<{ name: string; price: number }> }>;
      };
      assert.equal(body.stores[0].items[0].name, "Smoked Paprika");
      assert.equal(body.stores[0].items[0].price, 1.25);

      const saved = await Product.findOne({ name: "Smoked Paprika", brand: "Kroger" }).lean();
      assert.equal(saved?.price, 1.25);
      assert.equal(saved?.priceSource, "live");
      assert.ok(saved?.updatedAt);
      assert.ok(Date.now() - new Date(saved.updatedAt).getTime() < 60_000);
    } finally {
      krogerService.searchProducts = originalSearch;
      krogerService.getClosestStoreLocation = originalLookup;
      delete process.env.KROGER_CLIENT_ID;
      delete process.env.KROGER_CLIENT_SECRET;
    }
  });

  it("matches FatSecret names to local products by keywords, then the first two words", async () => {
    await Product.create({
      name: "Honey Nut Cheerios",
      brand: "General Mills",
      storeName: "Kroger",
      locationId: "01400441",
      price: 4.29,
      unit: "oz",
      normalizedUnit: "oz",
      lastUpdated: new Date(),
      updatedAt: new Date(),
    });

    const { status, json } = await optimize({
      items: [
        {
          name: "Honey Nut Cheerios Cereal",
          brand: "General Mills",
          foodId: "cheerios-hn",
          quantity: 1,
        },
      ],
      stores: ["Kroger"],
    });

    assert.equal(status, 200);
    const body = json as {
      stores: Array<{ items: Array<{ name: string; query: string; price: number }> }>;
      unavailable: string[];
    };
    assert.deepEqual(body.unavailable, []);
    assert.equal(body.stores[0].items[0].query, "Honey Nut Cheerios Cereal");
    assert.equal(body.stores[0].items[0].name, "Honey Nut Cheerios");
    assert.equal(body.stores[0].items[0].price, 4.29);
    await Product.deleteMany({ name: "Honey Nut Cheerios" });
  });

  it("prices Cheerios, honey, and sandwich bread from live Kroger when they are not seeded", async () => {
    setKrogerCreds();
    await Product.deleteMany({
      name: /cheerios|honey|sandwich bread/i,
    });
    const originalSearch = krogerService.searchProducts.bind(krogerService);
    const originalLookup = krogerService.getClosestStoreLocation.bind(krogerService);
    krogerService.getClosestStoreLocation = async () => "01400441";
    krogerService.searchProducts = async (term: string, locationId?: string) => {
      assert.equal(locationId, "01400441");
      const catalog: Record<string, Array<{ name: string; brand: string; price: number }>> = {
        Cheerios: [
          { name: "Cheerios Toasted Whole Grain Oat Cereal", brand: "General Mills", price: 4.29 },
        ],
        Honey: [{ name: "Sue Bee Clover Honey", brand: "Sue Bee", price: 5.49 }],
        "White Sandwich Bread": [
          { name: "Kroger White Sandwich Bread", brand: "Kroger", price: 1.59 },
        ],
      };
      return (catalog[term] ?? []).map((product) => ({
        ...product,
        storeName: "Kroger",
        locationId,
        unit: "oz" as const,
        normalizedUnit: "oz" as const,
      }));
    };

    try {
      const { status, json } = await optimize({
        items: [
          { name: "Cheerios", brand: "General Mills", quantity: 1 },
          { name: "Honey", brand: "Sue Bee", quantity: 1 },
          { name: "White Sandwich Bread (28g)", brand: "Great Value", quantity: 1 },
        ],
        zipCode: "45103",
      });

      assert.equal(status, 200);
      const body = json as {
        stores: Array<{
          storeName: string;
          items: Array<{ query: string; name: string; price: number }>;
          subtotal: number;
        }>;
        unavailable: string[];
        total: number;
      };
      assert.deepEqual(body.unavailable, []);
      assert.equal(body.stores.length, 1);
      assert.equal(body.stores[0].storeName, "Kroger");
      const byQuery = Object.fromEntries(
        body.stores[0].items.map((item) => [item.query, item])
      );
      assert.equal(byQuery.Cheerios.price, 4.29);
      assert.equal(byQuery.Cheerios.name, "Cheerios Toasted Whole Grain Oat Cereal");
      assert.equal(byQuery.Honey.price, 5.49);
      assert.equal(byQuery["White Sandwich Bread (28g)"].name, "Kroger White Sandwich Bread");
      assert.equal(byQuery["White Sandwich Bread (28g)"].price, 1.59);
      assert.equal(body.total, 11.37);
    } finally {
      krogerService.searchProducts = originalSearch;
      krogerService.getClosestStoreLocation = originalLookup;
      delete process.env.KROGER_CLIENT_ID;
      delete process.env.KROGER_CLIENT_SECRET;
      await Product.deleteMany({
        name: {
          $in: [
            "Cheerios Toasted Whole Grain Oat Cereal",
            "Sue Bee Clover Honey",
            "Kroger White Sandwich Bread",
          ],
        },
      });
    }
  });

  it("matches a FatSecret (28g) bread name to a local loaf without that serving token", async () => {
    await Product.create({
      name: "Great Value White Sandwich Bread",
      brand: "Great Value",
      storeName: "Kroger",
      locationId: "01400441",
      price: 1.29,
      unit: "oz",
      normalizedUnit: "oz",
      lastUpdated: new Date(),
      updatedAt: new Date(),
    });

    const { status, json } = await optimize({
      items: [
        {
          name: "White Sandwich Bread (28g)",
          brand: "Great Value",
          quantity: 1,
        },
      ],
      zipCode: "45103",
    });

    assert.equal(status, 200);
    const body = json as {
      stores: Array<{ items: Array<{ name: string; price: number }> }>;
      unavailable: string[];
    };
    assert.deepEqual(body.unavailable, []);
    assert.equal(body.stores[0].items[0].name, "Great Value White Sandwich Bread");
    assert.equal(body.stores[0].items[0].price, 1.29);
  });

  it("returns 503 when live Kroger pricing is down and the items are not in the catalog", async () => {
    setKrogerCreds();
    await Product.deleteMany({
      name: /cheerios|honey/i,
    });
    const originalSearch = krogerService.searchProducts.bind(krogerService);
    const originalLookup = krogerService.getClosestStoreLocation.bind(krogerService);
    krogerService.getClosestStoreLocation = async () => "01400441";
    krogerService.searchProducts = async () => {
      throw new Error(
        "Kroger API credentials are missing. Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET on the server."
      );
    };

    try {
      const { status, json } = await optimize({
        items: [
          { name: "Cheerios", brand: "General Mills", quantity: 1 },
          { name: "Honey", brand: "Sue Bee", quantity: 1 },
        ],
        zipCode: "45103",
      });

      assert.equal(status, 503);
      const body = json as { error: string; unavailable: string[] };
      assert.match(body.error, /Live store prices are unavailable/);
      assert.match(body.error, /KROGER_CLIENT_ID/);
      assert.deepEqual(body.unavailable, ["Cheerios", "Honey"]);
    } finally {
      krogerService.searchProducts = originalSearch;
      krogerService.getClosestStoreLocation = originalLookup;
      delete process.env.KROGER_CLIENT_ID;
      delete process.env.KROGER_CLIENT_SECRET;
    }
  });

  it("accepts verified product objects with quantities on items", async () => {
    const { status, json } = await optimize({
      items: [
        {
          name: "Gallon of Milk",
          brand: "Kroger",
          foodId: "50953",
          quantity: 2,
        },
      ],
      stores: ["Kroger"],
    });

    assert.equal(status, 200);
    const body = json as {
      stores: Array<{
        items: Array<{ name: string; quantity: number; itemTotal: number }>;
      }>;
    };
    assert.equal(body.stores[0].items[0].name, "Gallon of Milk");
    assert.equal(body.stores[0].items[0].quantity, 2);
    assert.equal(body.stores[0].items[0].itemTotal, 5.78);
  });

  it("includes a trip plan and per-store checkout handoff", async () => {
    const { status, json } = await optimize({
      groceryList: ["Gallon of Milk", "Loaf of Bread", "Dozen Eggs"],
      stores: ["Walmart", "Target", "Kroger"],
    });

    assert.equal(status, 200);
    const body = json as {
      tripPlan: { summary: string; storeCount: number; itemCount: number };
      stores: Array<{
        storeName: string;
        itemCount: number;
        handoff: {
          storeName: string;
          itemCount: number;
          action: { type: string; label: string; url?: string; status: string };
          items: Array<{ name: string; url?: string }>;
        };
      }>;
    };

    assert.equal(body.tripPlan.storeCount, 3);
    assert.match(body.tripPlan.summary, /Kroger/);
    assert.match(body.tripPlan.summary, /Walmart/);
    assert.match(body.tripPlan.summary, /Target/);

    const byStore = Object.fromEntries(
      body.stores.map((store) => [store.storeName, store])
    );

    assert.equal(byStore.Kroger.handoff.action.type, "search_deeplink");
    assert.equal(byStore.Kroger.handoff.action.label, "Open at Kroger");
    assert.equal(byStore.Kroger.handoff.action.status, "ready");
    assert.match(byStore.Kroger.handoff.action.url ?? "", /kroger\.com\/search/);
    assert.match(byStore.Kroger.handoff.items[0].url ?? "", /kroger\.com\/search/);

    assert.equal(byStore.Walmart.handoff.action.type, "search_deeplink");
    assert.equal(byStore.Walmart.handoff.action.label, "Search at Walmart");
    assert.match(byStore.Walmart.handoff.action.url ?? "", /walmart\.com\/search/);

    assert.equal(byStore.Target.handoff.action.type, "search_deeplink");
    assert.equal(byStore.Target.handoff.action.label, "Search at Target");
    assert.match(byStore.Target.handoff.action.url ?? "", /target\.com\/s/);

    const bodyWithPricing = json as {
      pricingByStore: Array<{ storeName: string; source: string; label: string }>;
      stores: Array<{ storeName: string; pricing?: { label: string; source: string } }>;
    };
    for (const store of bodyWithPricing.stores) {
      assert.equal(store.pricing?.source, "seed");
      assert.equal(store.pricing?.label, "Demo catalog");
    }
    const reportNames = bodyWithPricing.pricingByStore.map((row) => row.storeName).sort();
    assert.deepEqual(reportNames, ["Kroger", "Target", "Walmart"]);
  });

  it("splits a ZIP trip across live Kroger, Walmart, and Target when all three providers return prices", async () => {
    setKrogerCreds();
    process.env.WALMART_CONSUMER_ID = "walmart-consumer";
    process.env.WALMART_PRIVATE_KEY =
      "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----";
    process.env.WALMART_PUBLISHER_ID = "impact-1";
    process.env.TARGET_PARTNER_BASE_URL = "https://partner.example.test";
    process.env.TARGET_PARTNER_API_KEY = "partner-key";

    const originalKrogerSearch = krogerService.searchProducts.bind(krogerService);
    const originalLookup = krogerService.getClosestStoreLocation.bind(krogerService);
    const originalWalmart = walmartPricingProvider.searchProducts.bind(
      walmartPricingProvider
    );
    const originalTarget = targetPricingProvider.searchProducts.bind(
      targetPricingProvider
    );

    krogerService.getClosestStoreLocation = async () => "01400441";
    krogerService.searchProducts = async (term: string) => {
      const catalog: Record<string, { name: string; price: number }> = {
        "Oat Milk": { name: "Simple Truth Oat Milk", price: 2.1 },
        "Sourdough Loaf": { name: "Kroger Sourdough Loaf", price: 3.8 },
        "Pasture Eggs": { name: "Kroger Pasture Eggs", price: 4.2 },
      };
      const hit = catalog[term];
      return hit
        ? [
            {
              name: hit.name,
              brand: "Kroger",
              storeName: "Kroger",
              locationId: "01400441",
              price: hit.price,
              unit: "count",
              normalizedUnit: "count",
              productId: "k-" + term.replace(/\s+/g, "").toLowerCase(),
            },
          ]
        : [];
    };
    walmartPricingProvider.searchProducts = async (term: string) => {
      const catalog: Record<string, { name: string; price: number; id: string }> = {
        "Oat Milk": { name: "Great Value Oat Milk", price: 3.2, id: "w-oat" },
        "Sourdough Loaf": { name: "Marketside Sourdough Loaf", price: 1.15, id: "w-bread" },
        "Pasture Eggs": { name: "Great Value Pasture Eggs", price: 3.4, id: "w-eggs" },
      };
      const hit = catalog[term];
      return hit
        ? [
            {
              name: hit.name,
              brand: "Great Value",
              storeName: "Walmart",
              price: hit.price,
              unit: "count",
              normalizedUnit: "count",
              productId: hit.id,
              priceSource: "live",
            },
          ]
        : [];
    };
    targetPricingProvider.searchProducts = async (term: string) => {
      const catalog: Record<string, { name: string; price: number; id: string }> = {
        "Oat Milk": { name: "Good & Gather Oat Milk", price: 3.5, id: "t-oat" },
        "Sourdough Loaf": { name: "Good & Gather Sourdough Loaf", price: 2.4, id: "t-bread" },
        "Pasture Eggs": { name: "Good & Gather Pasture Eggs", price: 1.45, id: "t-eggs" },
      };
      const hit = catalog[term];
      return hit
        ? [
            {
              name: hit.name,
              brand: "Good & Gather",
              storeName: "Target",
              price: hit.price,
              unit: "count",
              normalizedUnit: "count",
              productId: hit.id,
              priceSource: "live",
            },
          ]
        : [];
    };

    try {
      const { status, json } = await optimize({
        groceryList: ["Oat Milk", "Sourdough Loaf", "Pasture Eggs"],
        zipCode: "45202",
      });
      assert.equal(status, 200);
      const body = json as {
        tripPlan: { summary: string };
        stores: Array<{
          storeName: string;
          items: Array<{ query: string; price: number; priceSource?: string }>;
          pricing?: { source: string; label: string };
          handoff: { action: { url?: string } };
        }>;
        pricingByStore: Array<{ storeName: string; source: string; label: string }>;
        pricingWarning?: string;
      };

      assert.equal(body.pricingWarning, undefined);
      assert.match(body.tripPlan.summary, /Kroger/);
      assert.match(body.tripPlan.summary, /Walmart/);
      assert.match(body.tripPlan.summary, /Target/);

      const byStore = Object.fromEntries(
        body.stores.map((store) => [store.storeName, store])
      );
      assert.equal(byStore.Kroger.items[0].query, "Oat Milk");
      assert.equal(byStore.Kroger.items[0].price, 2.1);
      assert.equal(byStore.Kroger.items[0].priceSource, "live");
      assert.equal(byStore.Kroger.pricing?.label, "Live prices");

      assert.equal(byStore.Walmart.items[0].query, "Sourdough Loaf");
      assert.equal(byStore.Walmart.items[0].price, 1.15);
      assert.equal(byStore.Walmart.pricing?.source, "live");
      assert.match(byStore.Walmart.handoff.action.url ?? "", /walmart\.com\/ip\/w-bread/);

      assert.equal(byStore.Target.items[0].query, "Pasture Eggs");
      assert.equal(byStore.Target.items[0].price, 1.45);
      assert.equal(byStore.Target.pricing?.source, "live");
      assert.match(byStore.Target.handoff.action.url ?? "", /target\.com\/p\/-\/A-t-eggs/);

      const liveReports = Object.fromEntries(
        body.pricingByStore.map((row) => [row.storeName, row])
      );
      assert.equal(liveReports.Kroger.source, "live");
      assert.equal(liveReports.Walmart.source, "live");
      assert.equal(liveReports.Target.source, "live");
    } finally {
      krogerService.searchProducts = originalKrogerSearch;
      krogerService.getClosestStoreLocation = originalLookup;
      walmartPricingProvider.searchProducts = originalWalmart;
      targetPricingProvider.searchProducts = originalTarget;
      clearPricingEnv();
    }
  });

  it("keeps a Kroger/Walmart seed split when Target live fails and labels the failure", async () => {
    setKrogerCreds();
    process.env.TARGET_PARTNER_BASE_URL = "https://partner.example.test";
    process.env.TARGET_PARTNER_API_KEY = "partner-key";

    const originalKrogerSearch = krogerService.searchProducts.bind(krogerService);
    const originalLookup = krogerService.getClosestStoreLocation.bind(krogerService);
    const originalTarget = targetPricingProvider.searchProducts.bind(
      targetPricingProvider
    );
    krogerService.getClosestStoreLocation = async () => "01400441";
    krogerService.searchProducts = async () => [];
    targetPricingProvider.searchProducts = async () => {
      throw new Error("Target partner feed failed (503)");
    };

    try {
      const { status, json } = await optimize({
        groceryList: ["Gallon of Milk", "Loaf of Bread", "Dozen Eggs"],
        zipCode: "45202",
        stores: ["Kroger", "Walmart", "Target"],
      });
      assert.equal(status, 200);
      const body = json as {
        stores: Array<{ storeName: string }>;
        pricingWarning?: string;
        pricingByStore: Array<{
          storeName: string;
          source: string;
          error?: string;
          usedFallback: boolean;
        }>;
      };
      const names = body.stores.map((store) => store.storeName).sort();
      assert.deepEqual(names, ["Kroger", "Target", "Walmart"]);
      assert.match(body.pricingWarning ?? "", /Target partner feed failed/);
      const targetReport = body.pricingByStore.find(
        (row) => row.storeName === "Target"
      );
      assert.equal(targetReport?.source, "seed");
      assert.equal(targetReport?.usedFallback, true);
      assert.match(targetReport?.error ?? "", /503/);
    } finally {
      krogerService.searchProducts = originalKrogerSearch;
      krogerService.getClosestStoreLocation = originalLookup;
      targetPricingProvider.searchProducts = originalTarget;
      clearPricingEnv();
    }
  });

  it("lets Flipp weekly-ad prices for Aldi and Target compete with live Kroger when FLIPP_ENABLED", async () => {
    process.env.FLIPP_ENABLED = "true";
    setKrogerCreds();

    const originalKrogerSearch = krogerService.searchProducts.bind(krogerService);
    const originalLookup = krogerService.getClosestStoreLocation.bind(krogerService);
    const stubs: Array<{
      store: string;
      original: FlippDealsProvider["searchProducts"];
    }> = [];

    function stubFlipp(
      storeName: string,
      search: FlippDealsProvider["searchProducts"]
    ): void {
      const provider = flippProviderForStore(storeName);
      assert.ok(provider, `expected Flipp mapping for ${storeName}`);
      stubs.push({
        store: storeName,
        original: provider.searchProducts.bind(provider),
      });
      provider.searchProducts = search;
    }

    krogerService.getClosestStoreLocation = async () => "01400441";
    krogerService.searchProducts = async (term: string) => {
      if (term !== "FlippAmaranth") {
        return [];
      }
      return [
        {
          name: "Simple Truth FlippAmaranth",
          brand: "Kroger",
          storeName: "Kroger",
          locationId: "01400441",
          price: 3.1,
          unit: "count",
          normalizedUnit: "count",
          productId: "k-amaranth",
        },
      ];
    };

    stubFlipp("Aldi", async (term, context) => {
      assert.equal(context?.zipCode, "45202");
      if (term !== "FlippAmaranth") {
        return [];
      }
      return [
        {
          name: "Friendly Farms FlippAmaranth",
          brand: "Friendly Farms",
          storeName: "Aldi",
          locationId: "45202",
          price: 1.79,
          unit: "count",
          normalizedUnit: "count",
          priceSource: "weekly_ad",
        },
      ];
    });
    stubFlipp("Target", async (term, context) => {
      assert.equal(context?.zipCode, "45202");
      if (term !== "FlippBokChoy") {
        return [];
      }
      return [
        {
          name: "Good & Gather FlippBokChoy",
          brand: "Good & Gather",
          storeName: "Target",
          locationId: "45202",
          price: 1.45,
          unit: "count",
          normalizedUnit: "count",
          priceSource: "weekly_ad",
        },
      ];
    });
    for (const store of ["Walmart", "Kroger", "Publix", "Meijer"] as const) {
      stubFlipp(store, async () => []);
    }

    try {
      const { status, json } = await optimize({
        groceryList: ["FlippAmaranth", "FlippBokChoy"],
        zipCode: "45202",
      });
      assert.equal(status, 200);
      const body = json as {
        stores: Array<{
          storeName: string;
          items: Array<{ query: string; price: number; priceSource?: string }>;
          pricing?: { source: string; label: string; detail: string };
        }>;
        pricingByStore: Array<{
          storeName: string;
          source: string;
          label: string;
        }>;
        pricingWarning?: string;
      };

      const byStore = Object.fromEntries(
        body.stores.map((store) => [store.storeName, store])
      );
      assert.equal(byStore.Aldi.items[0].query, "FlippAmaranth");
      assert.equal(byStore.Aldi.items[0].price, 1.79);
      assert.equal(byStore.Aldi.items[0].priceSource, "weekly_ad");
      assert.equal(byStore.Aldi.pricing?.label, "Weekly ad");
      assert.match(byStore.Aldi.pricing?.detail ?? "", /not a full live shelf/i);

      assert.equal(byStore.Target.items[0].query, "FlippBokChoy");
      assert.equal(byStore.Target.items[0].priceSource, "weekly_ad");
      assert.equal(byStore.Target.pricing?.label, "Weekly ad");

      assert.equal(byStore.Kroger, undefined);

      const reports = Object.fromEntries(
        body.pricingByStore.map((row) => [row.storeName, row])
      );
      assert.equal(reports.Aldi.source, "weekly_ad");
      assert.equal(reports.Target.source, "weekly_ad");
      assert.equal(reports.Kroger.source, "live");
    } finally {
      krogerService.searchProducts = originalKrogerSearch;
      krogerService.getClosestStoreLocation = originalLookup;
      for (const stub of stubs) {
        const provider = flippProviderForStore(stub.store);
        if (provider) {
          provider.searchProducts = stub.original;
        }
      }
      clearPricingEnv();
    }
  });

  it("keeps live Kroger prices when Flipp is also enabled", async () => {
    process.env.FLIPP_ENABLED = "true";
    setKrogerCreds();
    const originalKrogerSearch = krogerService.searchProducts.bind(krogerService);
    const originalLookup = krogerService.getClosestStoreLocation.bind(krogerService);
    const krogerFlipp = flippProviderForStore("Kroger");
    const originalFlipp = krogerFlipp?.searchProducts.bind(krogerFlipp);
    let flippCalls = 0;

    krogerService.getClosestStoreLocation = async () => "01400441";
    krogerService.searchProducts = async () => [
      {
        name: "Kroger FlippGuard Teff",
        brand: "Simple Truth",
        storeName: "Kroger",
        locationId: "01400441",
        price: 4.5,
        unit: "oz",
        normalizedUnit: "oz",
        productId: "k-teff",
      },
    ];
    if (krogerFlipp) {
      krogerFlipp.searchProducts = async () => {
        flippCalls += 1;
        return [];
      };
    }

    try {
      const { status, json } = await optimize({
        groceryList: ["FlippGuard Teff"],
        zipCode: "45202",
        stores: ["Kroger"],
      });
      assert.equal(status, 200);
      const body = json as {
        stores: Array<{
          storeName: string;
          items: Array<{ name: string; priceSource?: string }>;
          pricing?: { label: string; source: string };
        }>;
      };
      assert.equal(body.stores[0].storeName, "Kroger");
      assert.equal(body.stores[0].items[0].name, "Kroger FlippGuard Teff");
      assert.equal(body.stores[0].items[0].priceSource, "live");
      assert.equal(body.stores[0].pricing?.label, "Live prices");
      assert.equal(flippCalls, 0);
    } finally {
      krogerService.searchProducts = originalKrogerSearch;
      krogerService.getClosestStoreLocation = originalLookup;
      if (krogerFlipp && originalFlipp) {
        krogerFlipp.searchProducts = originalFlipp;
      }
      clearPricingEnv();
    }
  });
});
