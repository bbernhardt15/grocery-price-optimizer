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
});
