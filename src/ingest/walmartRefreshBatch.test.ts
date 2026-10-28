import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WALMART_AFFILIATE_DAILY_CAP } from "./config";
import {
  classifyWalmartRefresh,
  nextRefreshBatchLimit,
  planWalmartRefreshBatch,
  walmartItemsFromPayload,
  walmartOffersPerBudget,
  walmartRefreshCallCost,
  WALMART_LOOKUP_IDS_MAX,
} from "./walmartRefreshBatch";

const pick = (offerId: string, itemId: string | undefined, code: string) => ({ offerId, itemId, code });

describe("Walmart refresh batching", () => {
  it("puts up to 20 item ids on one call and leaves the rest", () => {
    const picks = Array.from({ length: 25 }, (_, index) =>
      pick(`offer-${index}`, String(500000 + index), "")
    );
    const plan = planWalmartRefreshBatch(picks, 20);
    assert.ok(plan);
    assert.equal(plan.mode, "ids");
    assert.equal(plan.values.length, WALMART_LOOKUP_IDS_MAX);
    assert.equal(plan.values[0], "500000");
    assert.equal(plan.values.at(-1), "500019");
    assert.equal(plan.offerIds.length, 20);
    assert.equal(plan.offerIds.includes("offer-24"), false);
    assert.equal(walmartRefreshCallCost(plan.values.length), 1);
  });

  it("falls back to UPCs when the offer has no item id", () => {
    const plan = planWalmartRefreshBatch(
      [
        pick("a", undefined, "049000042566"),
        pick("b", "not-numeric", "016000275287"),
        pick("c", "100001", "070708200500"),
      ],
      20
    );
    assert.ok(plan);
    assert.equal(plan.mode, "upc");
    assert.deepEqual(plan.values, ["049000042566", "016000275287", "070708200500"]);
    assert.deepEqual(plan.offerIds, ["a", "b", "c"]);
  });

  it("prefers item ids when the first offer has one", () => {
    const plan = planWalmartRefreshBatch(
      [pick("a", "100001", "049000042566"), pick("b", "100002", "016000275287")],
      20
    );
    assert.equal(plan?.mode, "ids");
    assert.deepEqual(plan?.values, ["100001", "100002"]);
  });

  it("classifies priced, unavailable, and missing ids from one response", () => {
    const picks = [
      pick("priced", "100001", "049000042566"),
      pick("bare", "100002", "016000275287"),
      pick("gone", "100003", "070708200500"),
    ];
    const items = walmartItemsFromPayload({
      items: [
        { itemId: 100001, name: "Coca-Cola", salePrice: 1.25, upc: "049000042566", stock: "Available" },
        { itemId: "100002", name: "Cheerios", stock: "Not available" },
      ],
    });
    const result = classifyWalmartRefresh(items, picks);
    assert.deepEqual(result.priced, ["priced"]);
    assert.deepEqual(result.unavailable, ["bare"]);
    assert.deepEqual(result.missing, ["gone"]);
  });

  it("shrinks after a 400 and grows back after a success", () => {
    assert.equal(nextRefreshBatchLimit(undefined, 20, 20, true), 10);
    assert.equal(nextRefreshBatchLimit(10, 10, 20, true), 5);
    assert.equal(nextRefreshBatchLimit(1, 1, 20, true), 1);
    assert.equal(nextRefreshBatchLimit(1, 1, 20, false), 2);
    assert.equal(nextRefreshBatchLimit(10, 10, 20, false), undefined);
    assert.equal(nextRefreshBatchLimit(undefined, 20, 20, false), undefined);
  });

  it("counts a batched call as one call under the daily cap", () => {
    assert.equal(walmartRefreshCallCost(1), 1);
    assert.equal(walmartRefreshCallCost(20), 1);
    assert.equal(walmartRefreshCallCost(WALMART_LOOKUP_IDS_MAX) * WALMART_AFFILIATE_DAILY_CAP, WALMART_AFFILIATE_DAILY_CAP);
    assert.equal(walmartOffersPerBudget(500, 1), 500);
    assert.equal(walmartOffersPerBudget(500, 20), 10_000);
    assert.equal(walmartOffersPerBudget(WALMART_AFFILIATE_DAILY_CAP, 20), 30_000);
    assert.equal(walmartOffersPerBudget(500, 100), 10_000);
  });
});
