import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatUnitPrice,
  parsePackageSize,
  stripPackageSizePhrases,
} from "./packageSize";

function assertSize(
  text: string,
  dimension: "volume" | "weight" | "count",
  amount: number
): void {
  const parsed = parsePackageSize(text);
  assert.ok(parsed, `expected a size for ${JSON.stringify(text)}`);
  assert.equal(parsed.dimension, dimension, text);
  assert.ok(
    Math.abs(parsed.amount - amount) < 0.05,
    `${text} → ${parsed.amount}, expected ${amount}`
  );
}

describe("parsePackageSize", () => {
  it("parses weight units", () => {
    assertSize("12 oz", "weight", 12);
    assertSize("12oz", "weight", 12);
    assertSize("12-oz", "weight", 12);
    assertSize("1 lb", "weight", 16);
    assertSize("2 lbs", "weight", 32);
    assertSize("1 pound", "weight", 16);
    assertSize("2 pounds", "weight", 32);
    assertSize("500 g", "weight", 17.637);
    assertSize("500g", "weight", 17.637);
    assertSize("1 kg", "weight", 35.274);
  });

  it("parses volume units including gallon fractions", () => {
    assertSize("12 fl oz", "volume", 12);
    assertSize("12 fl. oz.", "volume", 12);
    assertSize("64 floz", "volume", 64);
    assertSize("250 ml", "volume", 8.454);
    assertSize("1 L", "volume", 33.814);
    assertSize("1 l", "volume", 33.814);
    assertSize("2 liter", "volume", 67.628);
    assertSize("1 gallon", "volume", 128);
    assertSize("1 gal", "volume", 128);
    assertSize("Gallon of Milk", "volume", 128);
    assertSize("half gallon", "volume", 64);
    assertSize("half-gallon", "volume", 64);
    assertSize("half gal", "volume", 64);
    assertSize("1/2 gallon", "volume", 64);
    assertSize("1/2 gal", "volume", 64);
    assertSize("0.5 gal", "volume", 64);
    assertSize("½ gal", "volume", 64);
    assertSize("quart", "volume", 32);
    assertSize("1 qt", "volume", 32);
    assertSize("pint", "volume", 16);
    assertSize("1 pt", "volume", 16);
  });

  it("parses counts, dozens, and multipacks", () => {
    assertSize("12 ct", "count", 12);
    assertSize("18 count", "count", 18);
    assertSize("18 ct eggs", "count", 18);
    assertSize("6 pack", "count", 6);
    assertSize("6-pack", "count", 6);
    assertSize("dozen", "count", 12);
    assertSize("Dozen Eggs", "count", 12);
    assertSize("half dozen", "count", 6);
    assertSize("2 dozen", "count", 24);
    assertSize("2 x 12 fl oz", "volume", 24);
    assertSize("6 x 12 fl oz", "volume", 72);
    assertSize("6 pack 12 fl oz", "volume", 72);
    assertSize("4 pack 5.3 oz", "weight", 21.2);
  });

  it("ignores titles with no package size", () => {
    assert.equal(parsePackageSize("Honey Nut Cheerios"), null);
    assert.equal(parsePackageSize("Ground Beef 80/20"), null);
    assert.equal(parsePackageSize("Whole Milk"), null);
    assert.equal(parsePackageSize(""), null);
    assert.equal(parsePackageSize(undefined), null);
  });

  it("strips size phrases but keeps the product words", () => {
    assert.equal(stripPackageSizePhrases("1 gallon of milk"), "of milk");
    assert.equal(stripPackageSizePhrases("half gallon of milk"), "of milk");
    assert.equal(stripPackageSizePhrases("12 oz honey"), "honey");
    assert.equal(stripPackageSizePhrases("18 ct eggs"), "eggs");
    assert.equal(stripPackageSizePhrases("Dozen Eggs"), "Eggs");
    assert.equal(stripPackageSizePhrases("Honey Nut Cheerios"), "Honey Nut Cheerios");
  });

  it("formats a comparable unit price", () => {
    const gallon = parsePackageSize("1 gal");
    const half = parsePackageSize("0.5 gal");
    const honey = parsePackageSize("12 oz");
    const eggs = parsePackageSize("18 ct");
    assert.ok(gallon && half && honey && eggs);
    assert.deepEqual(formatUnitPrice(3.5, gallon), {
      unitPrice: 3.5,
      unitPriceText: "$3.50/gal",
    });
    assert.deepEqual(formatUnitPrice(2, half), {
      unitPrice: 4,
      unitPriceText: "$4.00/gal",
    });
    assert.deepEqual(formatUnitPrice(5.49, honey), {
      unitPrice: 0.46,
      unitPriceText: "$0.46/oz",
    });
    assert.deepEqual(formatUnitPrice(3.6, eggs), {
      unitPrice: 0.2,
      unitPriceText: "$0.20/ct",
    });
  });
});
