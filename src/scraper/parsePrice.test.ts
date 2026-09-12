import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePrice } from "./parsePrice";

describe("parsePrice", () => {
  it("reads a simple dollar amount", () => {
    assert.equal(parsePrice("$4.39"), 4.39);
  });

  it("prefers the sale price when both regular and sale are present", () => {
    assert.equal(parsePrice("Regular Price $5.99 Sale price $4.01"), 4.01);
  });

  it("ignores thousands separators", () => {
    assert.equal(parsePrice("$1,299.00"), 1299);
  });

  it("returns null when no price is present", () => {
    assert.equal(parsePrice("Add to cart"), null);
  });
});
