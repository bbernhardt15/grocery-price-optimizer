import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runStorePools } from "./storePool";

describe("price check pace", () => {
  it("runs a cached list in one wave instead of stacking the old store waits", async () => {
    const lines = 16;
    const eachMs = 30;
    const jobs = Array.from({ length: lines }, (_, index) => ({
      storeName: index % 2 === 0 ? "Kroger" : "Walmart",
      run: () => new Promise<void>((resolve) => setTimeout(resolve, eachMs)),
    }));
    const started = Date.now();
    await runStorePools(jobs, (job) => job.run(), { leadPool: 16, walmartPool: 16, walmartGraceMs: 0 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 250, `one wave took ${elapsed}ms`);
    const oldPoolWaves = Math.ceil(lines / 8) * eachMs;
    assert.ok(elapsed < oldPoolWaves + 80);
  });
});
