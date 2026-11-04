import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSpecialtyBrand, rankSearchResults, type RankItem } from "./searchRank";

function milk(id: string, brand: string, price: number, extra: Partial<RankItem> = {}): RankItem {
  return {
    id,
    name: extra.name || `${brand} Milk`,
    brand,
    storeBrand: false,
    bestOffer: { price },
    ...extra,
  };
}

describe("item search ranking", () => {
  const fairlife = milk("fairlife", "Fairlife", 4.98, { name: "Fairlife Milk, 52 fl oz" });
  const dairy = milk("dairy", "Dairy Pure", 3.08, { name: "Whole Milk" });
  const great = milk("gv", "Great Value", 2.48, { name: "Whole Milk", storeBrand: true });
  const shelf = [fairlife, dairy, great];

  it("does not lead with Fairlife when this shopper has never bought it", () => {
    const ranked = rankSearchResults(shelf, { query: "milk", family: "milk" });
    assert.deepEqual(
      ranked.map((item) => item.id),
      ["gv", "dairy", "fairlife"]
    );
    assert.equal(isSpecialtyBrand(fairlife), true);
    assert.notEqual(ranked[0]?.brand, "Fairlife");
  });

  it("puts purchase history, brand rules, and usuals ahead of price", () => {
    const history = rankSearchResults(shelf, {
      query: "milk",
      family: "milk",
      history: [{ name: "Whole Milk", brand: "Dairy Pure" }],
    });
    assert.equal(history[0]?.id, "dairy");
    assert.equal(history.at(-1)?.id, "fairlife");

    const rule = rankSearchResults(shelf, {
      query: "milk",
      family: "milk",
      preferences: [{ family: "milk", mode: "brand", brand: "Fairlife" }],
    });
    assert.equal(rule[0]?.id, "fairlife");

    const usual = rankSearchResults(shelf, {
      query: "milk",
      family: "milk",
      usuals: [{ name: "Whole Milk", brand: "Great Value" }],
    });
    assert.equal(usual[0]?.id, "gv");
    assert.ok(usual.findIndex((item) => item.id === "gv") < usual.findIndex((item) => item.id === "fairlife"));
  });

  it("ranks a store-brand preference and the cheaper store brand before specialty milk", () => {
    const kroger = milk("kroger", "Kroger", 2.79, { name: "2% Milk", storeBrand: true });
    const ranked = rankSearchResults([fairlife, great, kroger], {
      query: "milk",
      family: "milk",
      preferences: [{ family: "milk", mode: "storeBrand" }],
    });
    assert.deepEqual(
      ranked.map((item) => item.id),
      ["gv", "kroger", "fairlife"]
    );
  });
});
