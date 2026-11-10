import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runStorePools } from "./storePool";

describe("store pools", () => {
  it("returns the lead store before a stalled Walmart pool finishes 30 items", async () => {
    const skipped: string[] = [];
    let release = () => {};
    const hung = new Promise<void>((resolve) => {
      release = resolve;
    });
    const jobs = [
      ...Array.from({ length: 30 }, (_, index) => ({ storeName: "Kroger", line: `k${index}` })),
      ...Array.from({ length: 30 }, (_, index) => ({ storeName: "Walmart", line: `w${index}` })),
    ];
    const started = Date.now();
    await runStorePools(
      jobs,
      async (job) => {
        if (job.storeName === "Walmart") await hung;
      },
      {
        leadPool: 8,
        walmartPool: 4,
        walmartGraceMs: 200,
        onSkip: (job) => skipped.push(job.line),
      }
    );
    const elapsed = Date.now() - started;
    release();
    assert.ok(elapsed < 2_000, `plan waited ${elapsed}ms`);
    assert.ok(skipped.length >= 20);
  });
});
