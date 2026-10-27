import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { krogerSale, publishSale, saleEndDay, walmartSale } from "./saleFacts";

describe("sale facts", () => {
  it("keeps a calendar day from an ISO timestamp without shifting it", () => {
    assert.equal(saleEndDay("2026-11-08"), "2026-11-08");
    assert.equal(saleEndDay("2026-11-08T23:59:00-05:00"), "2026-11-08");
    assert.equal(saleEndDay("not a date"), undefined);
    assert.equal(saleEndDay("2026-13-40"), undefined);
  });

  it("publishes a sale only when the source already says so", () => {
    assert.equal(publishSale({ price: 2, onSale: false, regularPrice: 4 }), undefined);
    assert.equal(publishSale({ price: 2, regularPrice: 4 }), undefined);
    assert.deepEqual(publishSale({ price: 2.14, onSale: true }), { onSale: true });
    assert.deepEqual(publishSale({ price: 2.14, onSale: true, regularPrice: 2.14 }), { onSale: true });
    assert.deepEqual(publishSale({ price: 2.14, onSale: true, regularPrice: 1.5 }), { onSale: true });
    assert.deepEqual(
      publishSale({ price: 2.14, onSale: true, regularPrice: 2.639, saleEndsOn: "2026-11-08T00:00:00Z" }),
      { onSale: true, regularPrice: 2.64, saleEndsOn: "2026-11-08" }
    );
  });

  it("treats a Kroger promo below regular as the sale", () => {
    assert.deepEqual(krogerSale(2.99, 3.49, 2.99), { onSale: true, regularPrice: 3.49 });
    assert.deepEqual(krogerSale(2.99, undefined, 2.99), { onSale: true });
    assert.equal(krogerSale(4.29, 4.29, 0), undefined);
    assert.equal(krogerSale(4.29, 4.29, 4.29), undefined);
    assert.equal(krogerSale(4.29, 3.99, 4.99), undefined);
  });

  it("treats Walmart msrp as a was-price only when it is higher than the selling price", () => {
    assert.deepEqual(walmartSale(2.14, 2.14, 2.64), { onSale: true, regularPrice: 2.64 });
    assert.equal(walmartSale(2.44, 2.44, undefined), undefined);
    assert.equal(walmartSale(2.44, 2.44, 2.44), undefined);
    assert.equal(walmartSale(2.44, 2.44, 2.1), undefined);
    assert.equal(walmartSale(3, 2.14, 2.64), undefined);
  });
});
