import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { basketTeaserHtml, isFirstReceipt } from "../../public/shopper/intakePresent.js";
import { isEggSearchReject, productDisplayName, rankFoodMatches } from "../../public/shopper/matchSheet.js";

describe("v92 product titles", () => {
  it("puts the flavor before the product and does not comma the pack size", () => {
    assert.equal(
      productDisplayName({ familyName: "Coke", flavorLabel: "Cherry", sizeLabel: "12 pk" }),
      "Cherry Coke 12 pk"
    );
    assert.equal(productDisplayName({ familyName: "Coke Cherry", sizeLabel: "12 pk", flavorLabel: "Cherry" }), "Cherry Coke 12 pk");
    assert.equal(productDisplayName({ familyName: "Diet Coke", sizeLabel: "12 pk" }), "Diet Coke 12 pk");
    assert.equal(productDisplayName({ familyName: "Coke", flavorLabel: "Diet", sizeLabel: "12 pk" }), "Diet Coke 12 pk");
    assert.equal(productDisplayName({ familyName: "Coke", flavorLabel: "Vanilla", sizeLabel: "12 pk" }), "Vanilla Coke 12 pk");
    assert.equal(productDisplayName({ familyName: "Whole Milk", sizeLabel: "1 gal" }), "Whole Milk 1 gal");
    assert.equal(
      productDisplayName({ familyName: "Large Eggs", brand: "Great Value", sizeLabel: "12 ct" }),
      "Great Value Large Eggs 12 ct"
    );
    assert.equal(productDisplayName({ familyName: "Coke Cherry, 12 pk", flavorLabel: "Cherry", sizeLabel: "12 pk" }).includes(", 12"), false);
  });
});

describe("v92 search order and egg filter", () => {
  it("sorts flavor, then size", () => {
    const ranked = rankFoodMatches(
      [
        { name: "Coca-Cola", flavorLabel: "Cherry Float", sizeLabel: "12 pk" },
        { name: "Coca-Cola", flavorLabel: "Classic", sizeLabel: "2 L" },
        { name: "Coca-Cola", flavorLabel: "Cherry", sizeLabel: "12 pk" },
        { name: "Coca-Cola", flavorLabel: "Cherry", sizeLabel: "6 pk" },
      ],
      "Coca-Cola"
    );
    assert.deepEqual(
      ranked.map((item) => `${item.flavorLabel} ${item.sizeLabel}`),
      ["Cherry 6 pk", "Cherry 12 pk", "Cherry Float 12 pk", "Classic 2 L"]
    );
  });

  it("keeps real eggs sold in a carton and drops packaging and novelty eggs", () => {
    const items = [
      { name: "Large White Eggs, 12 ct carton" },
      { name: "Egg Beaters carton" },
      { name: "Pulp paper material holds 12 eggs" },
      { name: "Plastic Easter eggs" },
      { name: "Egg cooker" },
      { name: "Eggland's Best Large Eggs" },
    ];
    for (const item of items.slice(0, 2)) assert.equal(isEggSearchReject(item, "white eggs"), false, item.name);
    assert.equal(isEggSearchReject(items[5], "eggs"), false);
    assert.equal(isEggSearchReject(items[2], "white eggs"), true);
    assert.equal(isEggSearchReject(items[3], "eggs"), true);
    assert.equal(isEggSearchReject(items[4], "eggs"), true);
    const kept = rankFoodMatches(items, "white eggs").map((item) => item.name).sort();
    assert.deepEqual(kept, ["Egg Beaters carton", "Eggland's Best Large Eggs", "Large White Eggs, 12 ct carton"]);
    assert.equal(rankFoodMatches([{ name: "Large White Eggs, 12 ct carton" }], "milk").length, 1);
  });
});

describe("v92 first receipt", () => {
  it("treats a missing or empty trip list as the first receipt", () => {
    assert.equal(isFirstReceipt(null), true);
    assert.equal(isFirstReceipt(""), true);
    assert.equal(isFirstReceipt("[]"), true);
    assert.equal(isFirstReceipt([]), true);
    assert.equal(isFirstReceipt("not json"), true);
    assert.equal(isFirstReceipt([{ id: "1" }]), false);
    const first = basketTeaserHtml([], { firstReceipt: true });
    assert.match(first, /Your first receipt/);
    assert.doesNotMatch(first, /Your favorites/);
    const again = basketTeaserHtml([], { firstReceipt: false });
    assert.match(again, /Your favorites/);
  });
});
