import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  adoptReviewResult,
  coverageNotesFor,
  createReviewSession,
  genuineUnfound,
  planIsComplete,
  planIsShowable,
  pricesUpdatedLabel,
  shouldReusePlan,
  writePlanCache,
  readPlanCache,
} from "../../public/shopper/planCache.js";

function memory() {
  const bag = new Map<string, string>();
  return {
    getItem: (key: string) => bag.get(key) ?? null,
    setItem: (key: string, value: string) => {
      bag.set(key, value);
    },
    removeItem: (key: string) => {
      bag.delete(key);
    },
  };
}

function completePlan(total = 272.57) {
  return {
    total,
    partial: false,
    stores: [
      { storeName: "Kroger", subtotal: 200, items: [{ name: "Milk", query: "milk", price: 2, quantity: 1, itemTotal: 2 }] },
      { storeName: "Walmart", subtotal: 72.57, items: [{ name: "Bread", query: "bread", price: 1, quantity: 1, itemTotal: 1 }] },
    ],
    pricingByStore: [
      { storeName: "Kroger", check: "ok" },
      { storeName: "Walmart", check: "ok" },
    ],
    pricedAt: 1_000,
  };
}

describe("review price cache", () => {
  it("shows a plan that already has prices when a store check timed out", () => {
    const priced = {
      partial: true,
      pricingByStore: [{ storeName: "Walmart", check: "timeout" }],
      stores: [{ storeName: "Kroger", items: [{ name: "Milk", price: 2.99, quantity: 1 }] }],
    };
    assert.equal(planIsComplete(priced), false);
    assert.equal(planIsShowable(priced), true);
    assert.equal(planIsShowable({ stores: [{ items: [{ price: 0 }] }] }), false);
  });

  it("keeps previous prices when a recompute is partial or a store fails", () => {
    const previous = completePlan();
    const partial = {
      total: 289.31,
      partial: true,
      pendingStores: ["Walmart"],
      pricingByStore: [
        { storeName: "Kroger", check: "ok" },
        { storeName: "Walmart", check: "timeout" },
      ],
      stores: [{ storeName: "Kroger", subtotal: 289.31, items: [{ name: "Milk", price: 4, quantity: 1 }] }],
      unavailable: ["Bread"],
    };
    const kept = adoptReviewResult(previous, partial, 5_000);
    assert.equal(kept.keptPreviousPrices, true);
    assert.equal(kept.total, 272.57);
    assert.equal(kept.stores.find((store: { storeName: string }) => store.storeName === "Walmart").subtotal, 72.57);
    const failed = adoptReviewResult(previous, {
      ...completePlan(203.64),
      partial: false,
      pricingByStore: [
        { storeName: "Kroger", check: "error" },
        { storeName: "Walmart", check: "rate_limit" },
      ],
    });
    assert.equal(planIsComplete(failed), true);
    assert.equal(failed.total, 272.57);
    assert.equal(failed.keptPreviousPrices, true);
    assert.equal(
      failed.pricingByStore.every((row: { check?: string }) => row.check === "ok"),
      true
    );
  });

  it("returns the same total on three consecutive Review visits", () => {
    const session = createReviewSession();
    let calls = 0;
    const price = () => {
      calls += 1;
      if (calls === 1) return completePlan(272.57);
      if (calls === 2) {
        return {
          total: 289.31,
          partial: true,
          pendingStores: ["Walmart"],
          pricingByStore: [{ storeName: "Walmart", check: "timeout" }],
          stores: [{ storeName: "Kroger", items: [{ name: "Milk", price: 3, quantity: 1 }] }],
        };
      }
      return {
        total: 203.64,
        partial: true,
        unavailable: Array.from({ length: 19 }, (_item, index) => `item ${index}`),
        stores: [{ storeName: "Kroger", items: [{ name: "Milk", price: 1, quantity: 1 }] }],
      };
    };
    const visit = (now: number) => session.visit({ signature: "milk|1", zip: "45202", now, price });
    const first = visit(10_000);
    const second = visit(70_000);
    const third = visit(130_000);
    assert.equal(first.total, 272.57);
    assert.equal(second.total, 272.57);
    assert.equal(third.total, 272.57);
    assert.equal(second.source, "cache");
    assert.equal(third.source, "cache");
    assert.equal(calls, 1);
  });

  it("refreshes when the list changes, the cache is older than 24 hours, or Refresh is tapped", () => {
    const cache = {
      signature: "milk|1",
      zip: "45202",
      savedAt: 1_000,
      payload: completePlan(),
    };
    assert.equal(shouldReusePlan({ cache, signature: "milk|1", zip: "45202", now: 60_000 }), true);
    assert.equal(shouldReusePlan({ cache, signature: "milk|2", zip: "45202", now: 60_000 }), false);
    assert.equal(shouldReusePlan({ cache, signature: "milk|1", zip: "45203", now: 60_000 }), false);
    assert.equal(shouldReusePlan({ cache, signature: "milk|1", zip: "45202", now: 60_000, force: true }), false);
    const day = 24 * 60 * 60 * 1000;
    assert.equal(shouldReusePlan({ cache, signature: "milk|1", zip: "45202", now: 1_000 + day + 1 }), false);
    assert.equal(pricesUpdatedLabel(0, 120_000), "");
    assert.equal(pricesUpdatedLabel(120_000, 120_000), "Prices updated just now");
    assert.equal(pricesUpdatedLabel(60_000, 120_000), "Prices updated 1 minute ago");
    assert.equal(pricesUpdatedLabel(0, 180_000), "");
    assert.equal(pricesUpdatedLabel(60_000, 180_000), "Prices updated 2 minutes ago");
  });

  it("does not call a timed-out store's lines missing", () => {
    const notes = coverageNotesFor(
      { coverageNotes: [{ storeName: "Walmart", text: "Walmart is missing 33 items" }, { storeName: "Kroger", text: "Kroger is missing 1 item" }] },
      [
        { storeName: "Walmart", check: "timeout" },
        { storeName: "Kroger", check: "ok" },
      ]
    );
    assert.equal(notes.unchecked[0].text, "Walmart ran out of time on this check. Retry checks the lines still waiting.");
    assert.deepEqual(notes.missing.map((note: { text: string }) => note.text), ["Kroger is missing 1 item"]);
    assert.deepEqual(genuineUnfound(["Milk"], [{ check: "timeout" }, { check: "error" }]), []);
    assert.deepEqual(genuineUnfound(["Milk"], [{ storeName: "Kroger", check: "ok" }]), ["Milk"]);
    const storage = memory();
    assert.equal(writePlanCache(storage, { signature: "a", zip: "45202", savedAt: 5, payload: { partial: true, stores: [] } }), false);
    assert.equal(writePlanCache(storage, { signature: "a", zip: "45202", savedAt: 5, payload: completePlan() }), true);
    assert.equal(readPlanCache(storage)?.zip, "45202");
    const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
    assert.match(app, /shouldReusePlan/);
    assert.match(app, /adoptReviewResult/);
    assert.match(app, /pricesUpdatedLabel/);
  });
});
