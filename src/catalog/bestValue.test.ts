import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeUnitPrice as jsNormalize, selectBestValue as jsSelect } from "../../public/shopper/bestValue.js";
import { identifyFamily } from "./family";
import { normalizeUnitPrice, selectBestValue, type PricedSize } from "./bestValue";

function sized(id: string, name: string, brand: string, size: string, price: number, departmentId = "beverages"): PricedSize & { label: string } {
  const identity = identifyFamily({ name, brand, size, departmentId });
  return {
    id,
    price,
    totalAmount: identity.variant.totalAmount,
    totalDimension: identity.variant.totalDimension,
    label: identity.variant.label,
  };
}

describe("unit price normalization", () => {
  it("compares multipacks, mini cans, and liters per fluid ounce", () => {
    const twelve = sized("12", "Coca-Cola Classic 12 Pack 12 fl oz Cans", "Coca-Cola", "12 pk 12 fl oz", 7.48);
    const mini = sized("mini", "Coca-Cola Classic 8 Pack Mini Cans", "Coca-Cola", "8 pk 7.5 fl oz", 4.98);
    const bottle = sized("2l", "Coca-Cola 2 Liter Bottle", "Coca-Cola", "2 L", 2.48);
    assert.equal(twelve.totalAmount, 144);
    assert.equal(mini.totalAmount, 60);
    assert.equal(bottle.totalDimension, "volume");
    assert.ok(bottle.totalAmount != null && bottle.totalAmount > 60 && bottle.totalAmount < 70);
    const quote = normalizeUnitPrice(2.48, bottle.totalAmount, "volume");
    assert.equal(quote?.text, "$0.04/fl oz");
    const verdict = selectBestValue([twelve, mini, bottle], "unit");
    assert.equal(verdict.winnerId, "2l");
    assert.equal(verdict.comparable, true);
    assert.equal(verdict.largePack, false);
    assert.match(verdict.reason, /^\$0\.04\/fl oz, cheapest of 3 sizes$/);
    assert.deepEqual(verdict, jsSelect([twelve, mini, bottle], "unit"));
    assert.deepEqual(quote, jsNormalize(2.48, bottle.totalAmount, "volume"));
  });

  it("prices a count of eggs per item and does not rank that against fluid ounces", () => {
    const dozen = sized("12", "Large White Eggs", "Eggland's Best", "12 ct", 3.6, "dairy-eggs");
    const eighteen = sized("18", "Large White Eggs, 18 Count", "Eggland's Best", "18 ct", 4.5, "dairy-eggs");
    assert.equal(dozen.totalDimension, "count");
    assert.equal(dozen.totalAmount, 12);
    assert.equal(normalizeUnitPrice(3.6, 12, "count")?.text, "$0.30/each");
    const eggs = selectBestValue([dozen, eighteen], "unit");
    assert.equal(eggs.winnerId, "18");
    assert.match(eggs.reason, /\/each, cheapest of 2 sizes/);
    const mixed = selectBestValue(
      [
        { id: "can", price: 1, totalAmount: 12, totalDimension: "volume" },
        { id: "eggs", price: 2, totalAmount: 12, totalDimension: "count" },
      ],
      "unit"
    );
    assert.equal(mixed.comparable, false);
    assert.equal(mixed.winnerId, null);
    assert.match(mixed.reason, /different measures/);
    assert.equal(jsSelect(
      [
        { id: "can", price: 1, totalAmount: 12, totalDimension: "volume" },
        { id: "eggs", price: 2, totalAmount: 12, totalDimension: "count" },
      ],
      "unit"
    ).winnerId, null);
  });

  it("flags a much larger pack and can sort by the pack price instead", () => {
    const rows: PricedSize[] = [
      { id: "can", price: 1, totalAmount: 12, totalDimension: "volume" },
      { id: "pack", price: 6, totalAmount: 144, totalDimension: "volume" },
      { id: "case", price: 10, totalAmount: 420, totalDimension: "volume" },
    ];
    const unit = selectBestValue(rows, "unit");
    assert.equal(unit.winnerId, "case");
    assert.equal(unit.largePack, true);
    assert.match(unit.largePackNote, /Larger pack/);
    assert.match(unit.reason, /cheapest of 3 sizes/);
    const item = selectBestValue(rows, "item");
    assert.equal(item.winnerId, "can");
    assert.equal(item.largePack, false);
    assert.equal(item.reason, "$1.00, lowest price of 3 sizes");
    assert.deepEqual(item, jsSelect(rows, "item"));
  });

  it("skips the badge when the pack prices match", () => {
    const tied = selectBestValue(
      [
        { id: "xs", price: 0.75, totalAmount: null, totalDimension: null },
        { id: "m", price: 0.75, totalAmount: null, totalDimension: null },
      ],
      "item"
    );
    assert.equal(tied.winnerId, null);
    assert.equal(tied.reason, "Same price for these sizes.");
  });
});
