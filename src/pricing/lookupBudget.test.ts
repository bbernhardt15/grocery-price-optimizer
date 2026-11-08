import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StorePricingError } from "./types";
import {
  budgetOpen,
  couldntCheckNote,
  createLookupBudget,
  interleaveByStore,
  lookupIsRetryable,
  runPricedLookup,
  stableLineKey,
} from "./lookupBudget";
import { scopeStoreNames, showAdStores } from "./storeScope";

describe("lookup budget", () => {
  it("retries a timeout once and then reports the store unchecked", async () => {
    const budget = createLookupBudget(0, { deadlineMs: 10_000, maxCalls: 8, maxPerStore: 8 });
    let calls = 0;
    const outcome = await runPricedLookup({
      budget,
      storeName: "Walmart",
      now: () => 0,
      wait: async () => undefined,
      run: async () => {
        calls += 1;
        throw new StorePricingError("Walmart", "request timed out", "network", 408);
      },
    });
    assert.equal(calls, 2);
    assert.equal(outcome.status, "failed");
    if (outcome.status === "failed") assert.equal(outcome.kind, "timeout");
    assert.equal(couldntCheckNote("Walmart"), "Walmart couldn't check right now, retry");
    assert.match(couldntCheckNote("Walmart", "timeout"), /ran out of time/);
    assert.match(couldntCheckNote("Walmart", "rate_limit"), /slow down/);
    const jobs = [
      { storeName: "Kroger", lineName: "Milk" },
      { storeName: "Kroger", lineName: "Eggs" },
      { storeName: "Walmart", lineName: "Milk" },
      { storeName: "Walmart", lineName: "Eggs" },
    ];
    assert.deepEqual(
      interleaveByStore(jobs).map((job) => job.storeName),
      ["Kroger", "Walmart", "Kroger", "Walmart"]
    );
  });

  it("does not retry a real miss and stops when the call budget is spent", async () => {
    const budget = createLookupBudget(0, { deadlineMs: 10_000, maxCalls: 1, maxPerStore: 1 });
    let calls = 0;
    const miss = await runPricedLookup({
      budget,
      storeName: "Kroger",
      now: () => 0,
      wait: async () => undefined,
      run: async () => {
        calls += 1;
        return [];
      },
    });
    assert.equal(miss.status, "miss");
    assert.equal(calls, 1);
    const blocked = await runPricedLookup({
      budget,
      storeName: "Kroger",
      now: () => 0,
      run: async () => [{ name: "Milk" }],
    });
    assert.equal(blocked.status, "budget");
    assert.equal(budgetOpen(budget, "Walmart", 0), false);
    assert.equal(lookupIsRetryable(new StorePricingError("Kroger", "nope", "http", 400)), false);
    assert.equal(stableLineKey("Milk!"), stableLineKey("milk"));
    assert.equal(stableLineKey("Oat & Milk"), stableLineKey("oat and milk"));
  });
});

describe("store scope", () => {
  it("defaults plan generation to Kroger and Walmart", () => {
    const env = {} as NodeJS.ProcessEnv;
    assert.equal(showAdStores(env), false);
    assert.deepEqual(scopeStoreNames(["Target", "Aldi", "Kroger", "Meijer"], env), ["Kroger"]);
    assert.deepEqual(scopeStoreNames([], env), ["Kroger", "Walmart"]);
    assert.deepEqual(scopeStoreNames(["Whole Foods", "Costco", "Sam's Club"], env), ["Kroger", "Walmart"]);
    assert.deepEqual(scopeStoreNames(["Target", "Kroger"], { GG_SHOW_AD_STORES: "1" }), ["Target", "Kroger"]);
  });
});
