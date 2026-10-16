import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bestQuote, catalogProductKey, dropKey, evaluateDrop, itemIsWatched } from "./compare";

describe("price drop rules", () => {
  it("follows the list switch and a per-item override", () => {
    assert.equal(itemIsWatched(true, "inherit"), true);
    assert.equal(itemIsWatched(true, "off"), false);
    assert.equal(itemIsWatched(false, "on"), true);
    assert.equal(itemIsWatched(false, "inherit"), false);
  });

  it("picks the cheapest offer for the shopper ZIP and skips other stores' shelves", () => {
    const best = bestQuote(
      [
        { storeName: "Kroger", price: 0.99, zip: "90012", status: "active" },
        { storeName: "Kroger", price: 2.5, zip: "45103", status: "active" },
        { storeName: "Walmart", price: 3, zip: "", status: "active" },
        { storeName: "Aldi", price: 0.4, zip: "45103", availability: "out_of_stock", status: "active" },
        { storeName: "Target", price: 0.2, zip: "45103", status: "stale" },
      ],
      "45103"
    );
    assert.equal(best?.storeName, "Kroger");
    assert.equal(best?.price, 2.5);
  });

  it("alerts when the best price is under the saved price", () => {
    const drop = evaluateDrop({ baselinePrice: 4, bestPrice: 2.5 });
    assert.deepEqual(drop, {
      oldPrice: 4,
      newPrice: 2.5,
      savings: 1.5,
      reason: "saved",
      hitTarget: false,
    });
    assert.equal(evaluateDrop({ baselinePrice: 4, bestPrice: 4 }), null);
    assert.equal(evaluateDrop({ baselinePrice: 4, bestPrice: 4.25, targetPrice: 5 }), null);
  });

  it("treats a lower target as part of the same drop and ignores a repeat", () => {
    const drop = evaluateDrop({ baselinePrice: 4, targetPrice: 3, bestPrice: 2.5 });
    assert.equal(drop?.hitTarget, true);
    assert.equal(drop?.reason, "both");
    assert.equal(drop?.oldPrice, 4);
    const between = evaluateDrop({ baselinePrice: 4, targetPrice: 2, bestPrice: 3 });
    assert.equal(between?.hitTarget, false);
    assert.equal(between?.reason, "saved");
    assert.equal(evaluateDrop({ baselinePrice: 4, bestPrice: 2.5, lastNotifiedPrice: 2.5 }), null);
    const further = evaluateDrop({ baselinePrice: 4, bestPrice: 2, lastNotifiedPrice: 2.5 });
    assert.equal(further?.oldPrice, 2.5);
    assert.equal(further?.newPrice, 2);
    assert.equal(further?.savings, 0.5);
  });

  it("builds one key per saved price and new price", () => {
    assert.equal(dropKey("device", "list", "12345", 4, 2.5), "device:list:12345:400:250");
    assert.equal(catalogProductKey("upc:12345"), "12345");
    assert.equal(catalogProductKey("local:walmart:99"), "local:walmart:99");
  });
});
