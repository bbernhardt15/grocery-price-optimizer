import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryBudgetStore, RateGate, backoffDelayMs, retryClass, utcDay } from "./budget";

describe("ingest throttle", () => {
  it("classifies 429 and 5xx as retryable and other failures as fatal", () => {
    assert.equal(retryClass({ status: 429, message: "slow down" }), "rate");
    assert.equal(retryClass(new Error("Walmart Affiliate API failed (503)")), "server");
    assert.equal(retryClass({ status: 404 }), "fatal");
  });

  it("backs off exponentially and caps the delay", () => {
    assert.equal(backoffDelayMs(0, 1000, 60_000, () => 0), 1000);
    assert.equal(backoffDelayMs(2, 1000, 60_000, () => 0), 4000);
    assert.equal(backoffDelayMs(1, 1000, 60_000, () => 1), 2400);
    assert.equal(backoffDelayMs(10, 1000, 5000, () => 0), 5000);
  });

  it("spaces calls and stops at the daily budget", async () => {
    let clock = 1_000_000;
    const sleeps: number[] = [];
    const gate = new RateGate({
      provider: "walmart",
      dailyBudget: 2,
      minIntervalMs: 2000,
      store: new MemoryBudgetStore(),
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    assert.equal(await gate.take(), "ok");
    assert.equal(await gate.take(), "ok");
    assert.equal(await gate.take(), "budget");
    assert.deepEqual(sleeps, [2000]);
  });

  it("resets the budget on the next UTC day", async () => {
    const store = new MemoryBudgetStore();
    const first = new Date("2026-09-25T23:00:00.000Z");
    const next = new Date("2026-09-26T00:10:00.000Z");
    assert.equal(await store.tryConsume("kroger", 1, first), true);
    assert.equal(await store.tryConsume("kroger", 1, first), false);
    assert.equal(utcDay(next), "2026-09-26");
    assert.equal(await store.tryConsume("kroger", 1, next), true);
  });
});
