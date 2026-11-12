import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app";
import { setBrowsePauseForTests } from "../catalog/service";
import { Product } from "../models/Product";
import { mockProducts } from "../seed";
import { loopSnapshot, resetLoopGuardForTests } from "../runtime/loopGuard";

describe("browse burst keeps version and a partial plan", () => {
  let memory: MongoMemoryServer;
  let server: http.Server;
  let origin: string;

  before(async () => {
    resetLoopGuardForTests();
    delete process.env.KROGER_CLIENT_ID;
    delete process.env.KROGER_CLIENT_SECRET;
    delete process.env.WALMART_CONSUMER_ID;
    delete process.env.WALMART_PRIVATE_KEY;
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
    await Product.insertMany(mockProducts.map((product) => ({ ...product, lastUpdated: new Date(), updatedAt: new Date() })));
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    setBrowsePauseForTests(0);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await mongoose.disconnect();
    await memory.stop();
  });

  it("answers /api/version within 1s and returns a plan within 22s during 20 browses", async () => {
    setBrowsePauseForTests(200);
    const receipt = await fetch(`${origin}/api/import/receipt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "MILK GALLON                 3.29\nEGGS DOZEN                 2.49", zipCode: "45103" }),
    });
    assert.equal(receipt.status < 500, true);
    const browses = Array.from({ length: 20 }, () =>
      fetch(`${origin}/api/catalog/browse?q=milk&zip=45103&limit=8`)
    );
    const versionStarted = Date.now();
    const version = await fetch(`${origin}/api/version`);
    const versionMs = Date.now() - versionStarted;
    assert.equal(version.status, 200);
    assert.ok(versionMs < 1000, `version took ${versionMs}ms`);
    const versionBody = (await version.json()) as { shell?: string };
    assert.equal(versionBody.shell, "v90");
    const planStarted = Date.now();
    const plan = await fetch(`${origin}/api/optimize-list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        zipCode: "45103",
        groceryList: ["Gallon of Milk", "Dozen Eggs"],
        stores: ["Kroger", "Walmart"],
      }),
    });
    const planMs = Date.now() - planStarted;
    assert.ok(planMs < 22_000, `optimize-list took ${planMs}ms`);
    const body = (await plan.json()) as { stores?: unknown[]; total?: number; error?: string; partial?: boolean };
    assert.equal(plan.status, 200);
    assert.ok(Array.isArray(body.stores) && body.stores.length > 0);
    assert.notEqual(body.total, 0);
    assert.equal(String(body.error || "").includes("0 prices"), false);
    const settled = await Promise.all(browses);
    const busy = settled.filter((response) => response.status === 503).length;
    const ok = settled.filter((response) => response.status === 200).length;
    assert.equal(ok + busy, 20);
    assert.ok(ok <= 3);
    const loop = loopSnapshot();
    assert.equal(typeof loop.lagP99Ms, "number");
    assert.ok(loop.rejected >= busy);
  });
});
