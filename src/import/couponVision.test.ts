import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { couponReadApplies, parseCouponVision } from "./couponVision";

describe("coupon screenshot reading", () => {
  it("keeps a printed discount and leaves a missing date blank", () => {
    const read = parseCouponVision(
      JSON.stringify({
        storeName: "Kroger",
        itemName: "Large eggs",
        kind: "dollars",
        amount: 1.5,
        expiresOn: "",
        minQuantity: 2,
        minSpend: null,
        conditions: "When you buy 2",
      })
    );
    assert.equal(read.storeName, "Kroger");
    assert.equal(read.itemName, "Large eggs");
    assert.equal(read.kind, "dollars");
    assert.equal(read.amount, 1.5);
    assert.equal(read.expiresOn, "");
    assert.equal(read.minQuantity, 2);
    assert.equal(read.conditions, "When you buy 2");
    assert.deepEqual(read.gaps, []);
  });

  it("does not invent a discount when the amount is missing", () => {
    const read = parseCouponVision(
      JSON.stringify({
        storeName: "Kroger",
        itemName: "Milk",
        kind: "dollars",
        amount: null,
        conditions: "Clip to save",
      })
    );
    assert.equal(read.amount, null);
    assert.equal(read.kind, "");
    assert.ok(read.gaps.includes("amount"));
  });

  it("rejects a date that is not a real day and a percent over 100", () => {
    const read = parseCouponVision(
      JSON.stringify({
        storeName: "Walmart",
        itemName: "Bread",
        kind: "percent",
        amount: 150,
        expiresOn: "2026-02-31",
      })
    );
    assert.equal(read.amount, null);
    assert.equal(read.expiresOn, "");
    assert.ok(read.gaps.includes("amount"));
  });

  it("reads a Tide PODS coupon fixture without calling a vision model", () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/tide-pods-coupon.json", import.meta.url), "utf8"));
    const read = parseCouponVision(JSON.stringify(fixture));
    assert.equal(read.storeName, "Kroger");
    assert.equal(read.itemName, "Save $1 on any 2 Tide PODS");
    assert.equal(read.amount, 1);
    assert.equal(read.minQuantity, 2);
    assert.deepEqual(read.gaps, []);
  });

  it("withholds the discount until the printed quantity or spend is met", () => {
    const blocked = couponReadApplies({ minQuantity: 2, storeName: "Kroger" }, { quantity: 1 }, 4, "2026-11-08");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "quantity");
    const spend = couponReadApplies({ minSpend: 10 }, { quantity: 1 }, 4, "2026-11-08");
    assert.equal(spend.reason, "spend");
    const expired = couponReadApplies({ expiresOn: "2026-11-01" }, { quantity: 2 }, 4, "2026-11-08");
    assert.equal(expired.reason, "expired");
    const ready = couponReadApplies({ minQuantity: 2, expiresOn: "2026-11-30" }, { quantity: 2 }, 4, "2026-11-08");
    assert.equal(ready.ok, true);
  });
});
