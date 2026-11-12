import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KROGER_PRODUCT_ID_BATCH, krogerLocationGroup, krogerProductIdList, partitionKrogerBatch } from "./krogerBatch";

describe("kroger product-id batches", () => {
  it("keeps 50 comma-separated 13-digit ids and drops a duplicate", () => {
    const ids = Array.from({ length: 55 }, (_unused, index) => `0000000${String(10000 + index).slice(-5)}1`);
    const listed = krogerProductIdList([...ids, ids[0] ?? ""]);
    assert.equal(KROGER_PRODUCT_ID_BATCH, 50);
    assert.equal(listed.length, 50);
    assert.equal(listed[0], krogerProductIdList([ids[0] ?? ""])[0]);
  });

  it("maps a partial batch by product id or UPC and leaves the missing id out", () => {
    const picks = [
      { key: "0004138761190", code: "0004138761190", name: "4C Parmesan Grated Cheese" },
      { key: "0002100030165", code: "0002100030165", name: "Breakstone's All Natural Sour Cream" },
      { key: "0007835470318", code: "0007835470318", name: "Cabot Extra Sharp Cheddar" },
    ];
    const split = partitionKrogerBatch(picks, [
      { productId: "0004138761190", upc: "0004138761190", price: 5.17 },
      { productId: "0009990001112", upc: "0007835470318", price: 3.14 },
    ]);
    assert.deepEqual(split.hits.map((hit) => hit.pick.code), ["0004138761190", "0007835470318"]);
    assert.equal(split.hits[1]?.records[0]?.productId, "0009990001112");
    assert.deepEqual(split.misses.map((pick) => pick.code), ["0002100030165"]);
  });

  it("groups a refresh batch by the first location and leaves the other store for the next call", () => {
    const grouped = krogerLocationGroup(
      [
        { code: "0004138761190", locationId: "01400902" },
        { code: "0002100030165", locationId: "03500529" },
        { code: "0007835470318", locationId: "01400902" },
      ],
      "01400902"
    );
    assert.deepEqual(grouped.map((pick) => pick.code), ["0004138761190", "0007835470318"]);
  });
});
