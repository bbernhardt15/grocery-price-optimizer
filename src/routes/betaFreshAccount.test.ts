import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { Product } from "../models/Product";
import { mockProducts } from "../seed";
import { runFreshAccountJourney } from "../../public/shopper/freshJourney.js";

const ENV_KEYS = [
  "KROGER_CLIENT_ID",
  "KROGER_CLIENT_SECRET",
  "KROGER_REDIRECT_URI",
  "WALMART_CONSUMER_ID",
  "WALMART_PRIVATE_KEY",
  "WALMART_PUBLISHER_ID",
  "TARGET_PARTNER_BASE_URL",
  "TARGET_PARTNER_API_KEY",
  "FLIPP_ENABLED",
  "FLIPP_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "IMPORT_OPENAI_API_KEY",
  "IMPORT_ANTHROPIC_API_KEY",
  "IMPORT_AI_PROVIDER",
] as const;

describe("fresh account smoke", { concurrency: false }, () => {
  let memory: MongoMemoryServer;
  let server: http.Server;
  let origin: string;
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  before(async () => {
    for (const key of ENV_KEYS) delete process.env[key];
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
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoose.disconnect();
    await memory.stop();
  });

  it("walks a new shopper from ZIP and stores through text items to the review screen", { timeout: 60_000 }, async () => {
    const consoleErrors: string[] = [];
    const result = await runFreshAccountJourney({
      origin,
      fetch,
      console: {
        error: (...args: unknown[]) => {
          consoleErrors.push(args.map(String).join(" "));
        },
      },
    });

    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(result.errors, []);
    assert.equal(result.ready.ok, true);
    assert.equal(result.zip, "45202");
    assert.deepEqual(result.stores, ["Kroger", "Walmart", "Target"]);
    assert.equal(result.text, "milk, bread, eggs");
    assert.ok(result.typed.length >= 3);
    assert.ok(result.imported.items.length >= 3);
    assert.equal(result.plan.zipCode, "45202");
    assert.equal(result.screen.empty, false);
    assert.equal(result.screen.html.includes("empty-state"), false);
    assert.equal(result.screen.html.includes("Your list is empty"), false);
    assert.match(result.screen.html, /Review the split/);
    assert.ok(result.screen.storeCount >= 1);
    assert.ok(result.screen.itemCount >= 3);
    const names = result.screen.rows.map((row: { name: string }) => row.name.toLowerCase()).join(" ");
    assert.match(names, /milk/);
    assert.match(names, /bread/);
    assert.match(names, /eggs/);
    assert.ok(result.screen.rows.every((row: { price: number }) => row.price > 0));
    const page = fs.readFileSync(path.join(path.resolve(__dirname, "../.."), "public/index.html"), "utf8");
    assert.match(page, /id="trip"/);
    assert.match(page, /Review/);
  });
});
