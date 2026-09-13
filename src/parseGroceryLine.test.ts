import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGroceryLine, parseGroceryList } from "./parseGroceryLine";

describe("parseGroceryLine", () => {
  it("defaults to quantity 1 when no count is present", () => {
    assert.deepEqual(parseGroceryLine("Milk"), {
      raw: "Milk",
      name: "Milk",
      quantity: 1,
    });
  });

  it("reads a leading count", () => {
    assert.equal(parseGroceryLine("2 Milk")?.name, "Milk");
    assert.equal(parseGroceryLine("2 Milk")?.quantity, 2);
    assert.equal(parseGroceryLine("3 Eggs")?.name, "Eggs");
    assert.equal(parseGroceryLine("3 Eggs")?.quantity, 3);
  });

  it("reads 2x Milk and Milk x2 forms", () => {
    assert.deepEqual(parseGroceryLine("2x Milk"), {
      raw: "2x Milk",
      name: "Milk",
      quantity: 2,
    });
    assert.equal(parseGroceryLine("Milk x2")?.name, "Milk");
    assert.equal(parseGroceryLine("Milk x2")?.quantity, 2);
    assert.equal(parseGroceryLine("Milk x 2")?.quantity, 2);
  });

  it("does not treat 2% Milk as quantity 2", () => {
    assert.equal(parseGroceryLine("2% Milk")?.name, "2% Milk");
    assert.equal(parseGroceryLine("2% Milk")?.quantity, 1);
  });
});

describe("parseGroceryList", () => {
  it("sums quantities for the same product name", () => {
    const lines = parseGroceryList(["2 Milk", "Milk x1"]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].name, "Milk");
    assert.equal(lines[0].quantity, 3);
  });
});
