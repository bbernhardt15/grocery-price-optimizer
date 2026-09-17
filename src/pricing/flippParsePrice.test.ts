import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFlippPrice } from "./flipp/parsePrice";

describe("parseFlippPrice", () => {
  it("keeps numeric flyer prices and parses dollar strings", () => {
    assert.equal(parseFlippPrice(2.99), 2.99);
    assert.equal(parseFlippPrice("2.99"), 2.99);
    assert.equal(parseFlippPrice("$4.50"), 4.5);
    assert.equal(parseFlippPrice("1,299.00"), 1299);
  });

  it("skips BOGO / percent-off rows with no amount so we do not invent a price", () => {
    assert.equal(parseFlippPrice(null), null);
    assert.equal(parseFlippPrice(undefined), null);
    assert.equal(parseFlippPrice("BOGO 25% Off"), null);
    assert.equal(parseFlippPrice("25% Off"), null);
    assert.equal(parseFlippPrice(""), null);
    assert.equal(parseFlippPrice(-1), null);
  });
});
