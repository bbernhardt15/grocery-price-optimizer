import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupOffersByUpc } from "./normalize";
import { canonicalGtin14, gtinJoinKey, parseGtin } from "./gtin";
import type { RawCatalogRecord } from "./types";

const cheeriosWalmart = "016000124790";
const cheeriosKroger = "0001600012479";
const cokeWalmart = "049000042566";
const cokeKroger = "0004900004256";
function record(overrides: Partial<RawCatalogRecord> & Pick<RawCatalogRecord, "name" | "storeName" | "price">): RawCatalogRecord {
  return { brand: "Test", priceSource: "live", ...overrides };
}

describe("canonical GTIN", () => {
  it("maps real Walmart UPC-A and Kroger no-check ids onto one GTIN-14", () => {
    const pairs = [
      [cheeriosWalmart, cheeriosKroger],
      [cokeWalmart, cokeKroger],
      ["078742351896", "0007874235189"],
      ["100144318730", "0010014431873"],
      ["0071514150349", parseGtin("0071514150349")?.upcA ?? ""],
    ];
    for (const [walmart, kroger] of pairs) {
      assert.equal(canonicalGtin14(walmart), canonicalGtin14(kroger), walmart);
      assert.equal(gtinJoinKey(walmart), gtinJoinKey(kroger), walmart);
      assert.equal(parseGtin(kroger)?.upcA, walmart.length === 12 ? walmart : parseGtin(walmart)?.upcA);
    }
    assert.equal(canonicalGtin14(cheeriosWalmart), "00016000124790");
    assert.equal(canonicalGtin14(cokeWalmart), "00049000042566");
  });

  it("does not drop a Kroger digit when the 13-digit id accidentally passes GS1", () => {
    assert.notEqual(cheeriosKroger.slice(0, -1).replace(/^0+/, ""), gtinJoinKey(cheeriosWalmart));
    assert.equal(gtinJoinKey(cheeriosKroger), "1600012479");
    assert.equal(gtinJoinKey(cheeriosWalmart), "1600012479");
  });

  it("accepts UPC-E, a dropped leading zero, and a GTIN-14 pad", () => {
    const upcA = "012345000065";
    assert.equal(canonicalGtin14(`0${"123456"}5`), canonicalGtin14(upcA));
    assert.equal(gtinJoinKey("49000042566"), gtinJoinKey(cokeWalmart));
    assert.equal(canonicalGtin14(`00${cokeWalmart}`), canonicalGtin14(cokeWalmart));
    assert.equal(gtinJoinKey("1234567"), null);
  });

  it("groups a Walmart offer with the Kroger offer for the same item", () => {
    const products = groupOffersByUpc([
      record({
        name: "Honey Nut Cheerios",
        brand: "General Mills",
        storeName: "Walmart",
        price: 4.98,
        upc: cheeriosWalmart,
        productId: "944068996",
        departmentId: "breakfast",
      }),
      record({
        name: "Honey Nut Cheerios Cereal",
        brand: "General Mills",
        storeName: "Kroger",
        price: 3.99,
        upc: cheeriosKroger,
        productId: cheeriosKroger,
        departmentId: "breakfast",
      }),
    ]);
    assert.equal(products.length, 1);
    assert.equal(products[0]?.offers.length, 2);
    assert.equal(products[0]?.offers.some((offer) => offer.storeName === "Kroger" && offer.price === 3.99), true);
    assert.equal(products[0]?.offers.some((offer) => offer.storeName === "Walmart"), true);
  });
});
