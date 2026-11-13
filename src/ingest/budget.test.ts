import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryBudgetStore, RateGate, backoffDelayMs, krogerRateCooldownUntil, retryAfterMs, retryClass, utcDay, walmartCooldownUntil } from "./budget";
import { effectiveShares, lookupCallsForTick, nextTickTurn, tickCallSplit, walmartEffectiveShares } from "./config";

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

  it("prioritizes refresh above 30% stale and keeps a crawl and match floor", () => {
    const highKroger = effectiveShares({ staleRatio: 0.34, lookupShare: 0.5, refreshShare: 0.6 });
    assert.equal(highKroger.mode, "refresh");
    assert.equal(highKroger.refreshFirst, true);
    assert.equal(highKroger.lookupShare, 0.15);
    assert.equal(highKroger.discoveryShare, 0.15);
    assert.equal(highKroger.refreshShare, 0.7);
    assert.ok(highKroger.refreshShare + highKroger.lookupShare + highKroger.discoveryShare <= 1);

    const highWalmart = effectiveShares({ staleRatio: 0.34, lookupShare: 0.5, refreshShare: 0.3 });
    assert.equal(highWalmart.mode, "refresh");
    assert.equal(highWalmart.refreshFirst, true);
    assert.equal(highWalmart.lookupShare, 0.15);
    assert.equal(highWalmart.discoveryShare, 0.15);
    assert.equal(highWalmart.refreshShare, 0.7);
    const walmartTick = tickCallSplit(
      4,
      highWalmart.lookupShare,
      highWalmart.refreshShare,
      true,
      highWalmart.discoveryShare
    );
    assert.equal(walmartTick.discovery, 1);
    assert.equal(walmartTick.refresh, 2);
    assert.equal(walmartTick.lookup, 1);
    assert.equal(walmartTick.refresh + walmartTick.lookup + walmartTick.discovery, 4);

    const noFloor = effectiveShares({
      staleRatio: 0.34,
      lookupShare: 0.5,
      refreshShare: 0.3,
      staleDiscoveryShare: 0,
      staleLookupShare: 0.2,
    });
    assert.equal(noFloor.discoveryShare, 0);
    assert.equal(noFloor.lookupShare, 0.2);
    assert.equal(noFloor.refreshShare, 0.8);

    const low = effectiveShares({ staleRatio: 0.1, lookupShare: 0.5, refreshShare: 0.6 });
    assert.equal(low.mode, "discover");
    assert.equal(low.refreshFirst, false);
    assert.equal(low.refreshShare, 0.3);
    assert.equal(low.lookupShare, 0.5);

    const mid = effectiveShares({ staleRatio: 0.22, lookupShare: 0.5, refreshShare: 0.6 });
    assert.equal(mid.mode, "balanced");
    assert.equal(mid.discoveryShare, 0.15);
    assert.equal(mid.refreshShare, 0.464);
    assert.equal(mid.lookupShare, 0.386);
    assert.equal(mid.refreshFirst, false);
  });

  it("raises the Walmart refresh share above 25% stale and lowers it under 25%", () => {
    const high = walmartEffectiveShares({ staleRatio: 0.349, lookupShare: 0.5, refreshShare: 0.3 });
    assert.equal(high.mode, "refresh");
    assert.equal(high.refreshFirst, true);
    assert.ok(high.refreshShare >= 0.8);
    assert.equal(high.lookupShare, 0);
    assert.equal(high.configuredRefreshShare, 0.3);
    const tick = tickCallSplit(4, high.lookupShare, high.refreshShare, high.refreshFirst, high.discoveryShare);
    assert.equal(tick.refresh, 3);
    assert.equal(tick.discovery, 1);
    assert.equal(tick.lookup, 0);
    assert.equal(tick.refresh + tick.lookup + tick.discovery, 4);

    const hold = walmartEffectiveShares({ staleRatio: 0.287, lookupShare: 0.5, refreshShare: 0.3 });
    assert.equal(hold.mode, "refresh");
    assert.equal(hold.refreshFirst, true);
    assert.ok(hold.refreshShare >= 0.8);
    assert.equal(hold.discoveryShare, 0.15);
    assert.equal(hold.lookupShare, 0);
    assert.equal(hold.adaptedRefreshShare, hold.refreshShare);

    const low = walmartEffectiveShares({ staleRatio: 0.22, lookupShare: 0.5, refreshShare: 0.3 });
    assert.equal(low.mode, "discover");
    assert.equal(low.refreshFirst, false);
    assert.equal(low.refreshShare, 0.15);
    assert.equal(low.adaptedRefreshShare, 0.15);

    const kroger = effectiveShares({ staleRatio: 0.287, lookupShare: 0.5, refreshShare: 0.6 });
    assert.equal(kroger.mode, "balanced");
    assert.equal(kroger.discoveryShare, 0.15);
    assert.ok(kroger.refreshShare > 0.4);
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
    assert.equal(
      nextTickTurn({
        ...base,
        refreshFirst: true,
        refreshesDone: 2,
        refreshBudget: 2,
        lookupsDone: 1,
        discoveryDone: 0,
        discoveryBudget: 1,
      }),
      "discover"
    );
    assert.equal(
      nextTickTurn({
        ...base,
        refreshFirst: true,
        refreshesDone: 2,
        refreshBudget: 2,
        lookupsDone: 1,
        discoveryDone: 1,
        discoveryBudget: 1,
      }),
      "refresh"
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

  it("pauses Kroger longer on each 429 and keeps a longer Retry-After", () => {
    const now = new Date("2026-11-13T12:47:00.000Z");
    assert.equal(krogerRateCooldownUntil(now, 1, null), "2026-11-13T12:47:30.000Z");
    assert.equal(krogerRateCooldownUntil(now, 2, null), "2026-11-13T12:48:00.000Z");
    assert.equal(krogerRateCooldownUntil(now, 3, null), "2026-11-13T12:49:00.000Z");
    assert.equal(krogerRateCooldownUntil(now, 1, 120_000), "2026-11-13T12:49:00.000Z");
    const error = Object.assign(new Error("429"), { status: 429, headers: { "retry-after": "120" } });
    assert.equal(retryAfterMs(error, now), 120_000);
    const dated = Object.assign(new Error("429"), {
      status: 429,
      headers: { "retry-after": "Fri, 13 Nov 2026 12:49:00 GMT" },
    });
    assert.equal(retryAfterMs(dated, now), 120_000);
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

  it("refunds a charge so a 5xx can be retried without spending the day", async () => {
    const store = new MemoryBudgetStore();
    const now = new Date("2026-11-04T12:00:00.000Z");
    assert.equal(await store.tryConsume("kroger", 1, now), true);
    assert.equal(await store.used("kroger", now), 1);
    await store.refund("kroger", now);
    assert.equal(await store.used("kroger", now), 0);
    assert.equal(await store.tryConsume("kroger", 1, now), true);
    await store.refund("kroger", now);
    await store.refund("kroger", now);
    assert.equal(await store.used("kroger", now), 0);
  });
});
