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

describe("POST /api/optimize-list", () => {
  let memory: MongoMemoryServer;
  let server: http.Server;
  let origin: string;

  before(async () => {
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

  it("rejects an empty zipCode string", async () => {
    const { status, json } = await optimize({
      groceryList: ["milk"],
      zipCode: "  ",
    });
    assert.equal(status, 400);
    const body = json as { error: string };
    assert.match(body.error, /zipCode/i);
  });

  it("skips the live Products API when matching rows are fresher than 24 hours", async () => {
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
        stores: Array<{ items: Array<{ name: string; price: number }> }>;
      };
      assert.equal(body.stores[0].items[0].name, "Gallon of Milk");
      assert.equal(body.stores[0].items[0].price, 2.89);
      assert.equal(liveCalls, 0);
    } finally {
      krogerService.searchProducts = originalSearch;
    }
  });

  it("on a cache miss, fetches live Kroger prices and upserts them before optimizing", async () => {
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
      assert.ok(saved?.updatedAt);
      assert.ok(Date.now() - new Date(saved.updatedAt).getTime() < 60_000);
    } finally {
      krogerService.searchProducts = originalSearch;
      krogerService.getClosestStoreLocation = originalLookup;
    }
  });

  it("treats rows older than 24 hours as a cache miss and refreshes them", async () => {
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
      assert.ok(saved?.updatedAt);
      assert.ok(Date.now() - new Date(saved.updatedAt).getTime() < 60_000);
    } finally {
      krogerService.searchProducts = originalSearch;
      krogerService.getClosestStoreLocation = originalLookup;
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
});
