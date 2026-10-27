import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryBudgetStore, RateGate, backoffDelayMs, retryClass, utcDay, walmartCooldownUntil } from "./budget";
import { effectiveShares, lookupCallsForTick, nextTickTurn, tickCallSplit } from "./config";

describe("lookup share", () => {
  it("gives lookups a fraction of the tick and at least one call when the share is above zero", () => {
    assert.equal(lookupCallsForTick(4, 0.5), 2);
    assert.equal(lookupCallsForTick(1, 0.5), 1);
    assert.equal(lookupCallsForTick(4, 0.25), 1);
    assert.equal(lookupCallsForTick(4, 1), 4);
    assert.equal(lookupCallsForTick(4, 0), 0);
  });

  it("reserves lookup first, then refresh, and leaves the rest for discovery", () => {
    assert.deepEqual(tickCallSplit(4, 0.5, 0.3), { lookup: 2, refresh: 1, discovery: 1 });
    assert.deepEqual(tickCallSplit(4, 0.5, 0), { lookup: 2, refresh: 0, discovery: 2 });
    assert.deepEqual(tickCallSplit(1, 0.5, 0.3), { lookup: 1, refresh: 0, discovery: 0 });
    assert.deepEqual(tickCallSplit(4, 1, 0.3), { lookup: 4, refresh: 0, discovery: 0 });
  });

  it("reserves refresh first when the shelf is stale", () => {
    assert.deepEqual(tickCallSplit(4, 0.2, 0.8, true), { lookup: 1, refresh: 3, discovery: 0 });
    assert.deepEqual(tickCallSplit(4, 0.2, 0.6, true), { lookup: 1, refresh: 2, discovery: 1 });
    assert.deepEqual(tickCallSplit(1, 0.2, 0.6, true), { lookup: 0, refresh: 1, discovery: 0 });
  });

  it("prioritizes refresh above 30% stale and gives it back below 15%", () => {
    const highKroger = effectiveShares({ staleRatio: 0.34, lookupShare: 0.5, refreshShare: 0.6 });
    assert.equal(highKroger.mode, "refresh");
    assert.equal(highKroger.refreshFirst, true);
    assert.equal(highKroger.lookupShare, 0.2);
    assert.equal(highKroger.refreshShare, 0.8);
    assert.ok(highKroger.refreshShare + highKroger.lookupShare <= 1);

    const highWalmart = effectiveShares({ staleRatio: 0.34, lookupShare: 0.5, refreshShare: 0.3 });
    assert.equal(highWalmart.mode, "refresh");
    assert.equal(highWalmart.refreshFirst, true);
    assert.equal(highWalmart.lookupShare, 0.2);
    assert.equal(highWalmart.refreshShare, 0.8);
    const walmartTick = tickCallSplit(4, highWalmart.lookupShare, highWalmart.refreshShare, true);
    assert.equal(walmartTick.discovery, 0);
    assert.equal(walmartTick.refresh, 3);
    assert.equal(walmartTick.lookup, 1);

    const low = effectiveShares({ staleRatio: 0.1, lookupShare: 0.5, refreshShare: 0.6 });
    assert.equal(low.mode, "discover");
    assert.equal(low.refreshFirst, false);
    assert.equal(low.refreshShare, 0.3);
    assert.equal(low.lookupShare, 0.5);

    const mid = effectiveShares({ staleRatio: 0.22, lookupShare: 0.5, refreshShare: 0.6 });
    assert.equal(mid.mode, "balanced");
    assert.equal(mid.refreshShare, 0.6);
    assert.equal(mid.lookupShare, 0.5);
    assert.equal(mid.refreshFirst, false);
  });

  it("does not invent refresh budget or cut a tick that is entirely lookups", () => {
    const off = effectiveShares({ staleRatio: 0.5, lookupShare: 0.5, refreshShare: 0 });
    assert.equal(off.refreshShare, 0);
    assert.equal(off.lookupShare, 0.5);
    assert.equal(off.refreshFirst, false);

    const allLookup = effectiveShares({ staleRatio: 0.5, lookupShare: 1, refreshShare: 0.6 });
    assert.equal(allLookup.lookupShare, 1);
    assert.equal(allLookup.refreshShare, 0);
  });

  it("refreshes before crawling while stale, and gives unused lookup calls back to refresh", () => {
    const base = {
      lookupPending: true,
      refreshPending: true,
      lookupsDone: 0,
      lookupBudget: 1,
      refreshesDone: 0,
      refreshBudget: 3,
    };
    assert.equal(nextTickTurn({ ...base, refreshFirst: true }), "refresh");
    assert.equal(
      nextTickTurn({ ...base, refreshFirst: true, refreshesDone: 3 }),
      "lookup"
    );
    assert.equal(
      nextTickTurn({ ...base, refreshFirst: true, lookupPending: false, refreshesDone: 3 }),
      "refresh"
    );
    assert.equal(
      nextTickTurn({ ...base, refreshFirst: true, refreshPending: false }),
      "lookup"
    );
    assert.equal(
      nextTickTurn({ ...base, refreshFirst: true, lookupPending: false, refreshPending: false }),
      "discover"
    );
    assert.equal(nextTickTurn({ ...base, refreshFirst: false, lookupBudget: 2, refreshBudget: 1 }), "lookup");
  });
});

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

  it("cools a Walmart 429 down until the next slot, and not past UTC midnight", () => {
    const afternoon = walmartCooldownUntil(new Date("2026-09-25T18:40:00.000Z"), 1);
    assert.equal(afternoon, "2026-09-25T18:55:00.000Z");
    const doubled = walmartCooldownUntil(new Date("2026-09-25T18:40:00.000Z"), 2);
    assert.equal(doubled, "2026-09-25T19:10:00.000Z");
    const late = walmartCooldownUntil(new Date("2026-09-25T23:50:00.000Z"), 2);
    assert.equal(late, "2026-09-26T00:00:00.000Z");
  });

  it("stops Walmart for the rest of the UTC day after repeated 429s", () => {
    const midday = walmartCooldownUntil(new Date("2026-09-29T13:12:00.000Z"), 3);
    assert.equal(midday, "2026-09-30T00:00:00.000Z");
    const evening = walmartCooldownUntil(new Date("2026-09-29T20:30:00.000Z"), 4);
    assert.equal(evening, "2026-09-30T02:30:00.000Z");
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
