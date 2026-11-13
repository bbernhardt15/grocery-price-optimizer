import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { krogerLookupBlock } from "../ingest/crossLookup";
import { isGroceryUpc, krogerLookupCodes, krogerRequestId } from "./normalize";

/**
 * Production catalog ids from the Nov 13 health check (ZIP 45103).
 * Produce rows are IFPS PLUs. Household rows are Kroger product ids and the
 * Walmart UPC-A for the same item. A hit is a code the matcher will send,
 * equal to the 13-digit id Kroger already uses for that product.
 */
const SAMPLES = [
  { category: "produce", upc: "0000000094011", expect: "0000000094011", name: "Organic bananas", before: false },
  { category: "produce", upc: "94011", expect: "0000000094011", name: "Organic bananas", before: false },
  { category: "produce", upc: "0000000094065", expect: "0000000094065", name: "Organic green bell pepper", before: false },
  { category: "produce", upc: "0000000094061", expect: "0000000094061", name: "Organic iceberg lettuce", before: false },
  { category: "produce", upc: "0000000004134", expect: "0000000004134", name: "Gala apple", before: false },
  { category: "produce", upc: "4011", expect: "0000000004011", name: "Bananas", before: false },
  { category: "produce", upc: "4061", expect: "0000000004061", name: "Iceberg lettuce", before: false },
  { category: "produce", upc: "071279108087", expect: "0007127910808", name: "Fresh Express romaine", before: true },
  { category: "household", upc: "0000307721357", expect: "0000307721357", name: "Charmin Ultra Strong Mega XXL", before: false },
  { category: "household", upc: "307721357", expect: "0000307721357", name: "Charmin Ultra Strong Mega XXL", before: false },
  { category: "household", upc: "0003077216564", expect: "0003077216564", name: "Charmin Ultra Soft 12 Mega", before: true },
  { category: "household", upc: "033200003540", expect: "0003320000354", name: "Arm & Hammer OxiClean", before: true },
  { category: "household", upc: "0007261345632", expect: "0007261345632", name: "all Free Clear detergent", before: true },
] as const;

function sends(upc: string, name: string, category: string): boolean {
  const code = krogerRequestId(upc);
  const expected = SAMPLES.find((row) => row.upc === upc)?.expect;
  if (!code || code !== expected || !isGroceryUpc(upc)) return false;
  const block = krogerLookupBlock({
    name,
    departmentId: category,
    upc,
    categoryPaths: category === "household" ? ["Household/Laundry"] : ["Produce/Fruit"],
  });
  return block === null && krogerLookupCodes(upc)[0] === expected;
}

function rate(category: string, when: "before" | "after"): number {
  const rows = SAMPLES.filter((row) => row.category === category);
  const hits = rows.filter((row) => (when === "before" ? row.before : sends(row.upc, row.name, row.category))).length;
  return hits / rows.length;
}

describe("Nov 13 Kroger miss samples", () => {
  it("sends produce PLUs as the 13-digit id Kroger stores", () => {
    assert.equal(krogerRequestId("0000000094065"), "0000000094065");
    assert.equal(krogerRequestId("94065"), "0000000094065");
    assert.equal(krogerRequestId("4011"), "0000000004011");
    assert.equal(isGroceryUpc("12345"), false);
    assert.equal(krogerRequestId("0099999700801"), null);
    assert.equal(isGroceryUpc("0099999700801"), false);
    assert.equal(krogerLookupBlock({ name: "Toilet Paper", departmentId: "household", upc: "0099999700801" }), "upc-check");
  });

  it("raises the sample hit rate for produce and household", () => {
    assert.equal(rate("produce", "before"), 1 / 8);
    assert.equal(rate("produce", "after"), 1);
    assert.equal(rate("household", "before"), 3 / 5);
    assert.equal(rate("household", "after"), 1);
  });
});
