import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayProductName, listItemTitle, shortProductTitle, stagedQuantity } from "../../public/shopper/familyTile.js";

describe("family tile labels", () => {
  it("shows the family name and the chosen variant, not the retailer title", () => {
    const coke = listItemTitle({
      name: "Coca-Cola Classic 12 Pack 12 fl oz Cans",
      familyName: "Coca-Cola",
      brand: "Coca-Cola",
      variantLabel: "12 pk · 12 fl oz cans",
      sizeLabel: "12 pk 12 fl oz",
    });
    assert.equal(coke.title, "Coca-Cola");
    assert.equal(coke.detail, "12 pk · 12 fl oz cans");

    const ranch = listItemTitle({
      name: "Doritos Cool Ranch Tortilla Chips 9.25 oz Bag",
      familyName: "Doritos Cool Ranch",
      brand: "Doritos",
      variantLabel: "9.25 oz bag",
    });
    assert.equal(ranch.title, "Doritos Cool Ranch");
    assert.equal(ranch.detail, "9.25 oz bag");
  });

  it("keeps a brand that is not already in the family name", () => {
    const diet = listItemTitle({
      name: "Diet Coke 12 Pack 12 fl oz Cans",
      familyName: "Diet Coke",
      brand: "Coca-Cola",
      variantLabel: "12 pk · 12 fl oz cans",
    });
    assert.equal(diet.title, "Diet Coke");
    assert.equal(diet.detail, "Coca-Cola · 12 pk · 12 fl oz cans");
  });

  it("still labels an older saved row that has no family fields", () => {
    const saved = listItemTitle({
      name: "Coca-Cola Classic 12 Pack 12 fl oz Cans",
      brand: "Coca-Cola",
      sizeLabel: "12 fl oz",
    });
    assert.equal(saved.title, "Coca-Cola Classic 12 Pack 12 fl oz Cans");
    assert.equal(saved.detail, "12 fl oz");
  });

  it("drops a repeated brand and quiets shouting", () => {
    assert.equal(displayProductName("Gerber Gerber Juice, 4 oz", "Gerber"), "Gerber Juice, 4 oz");
    assert.equal(displayProductName("GERBER Pear juice", "GERBER"), "Gerber Pear juice");
    assert.equal(displayProductName("GERBER GERBER JUICE", "GERBER"), "Gerber Juice");
    assert.equal(displayProductName("Coca-Cola Classic 12 Pack 12 fl oz Cans", "Coca-Cola"), "Coca-Cola Classic 12 Pack 12 fl oz Cans");
    assert.equal(
      shortProductTitle({
        name: "1.5 OZ Original Beef Jerky 100% Beef Slow Cooked Smoked Over Mesquite",
        brand: "Jack Link's",
        size: "1.5 oz",
      }),
      "Jack Link's Original Beef Jerky, 1.5 oz"
    );
    const juice = listItemTitle({ name: "Gerber Gerber Juice, 4 oz", brand: "Gerber" });
    assert.equal(juice.title, "Gerber Juice, 4 oz");
  });

  it("cleans duplicated produce titles and long gelato titles", () => {
    assert.equal(
      shortProductTitle({
        name: "Fresh Bananas Fresh Bunch of Bananas -, 1 lb",
        brand: "Fresh",
        size: "1 lb",
      }),
      "Bananas, 1 lb"
    );
    assert.equal(
      shortProductTitle({
        name: "Talenti Gelato Non-GMO Black Raspberry Chocolate Chip Frozen Dessert Gluten-Free, 1 Pint 1 Count",
        brand: "Talenti",
        size: "1 pint",
      }),
      "Talenti Black Raspberry Chocolate Chip Gelato, 1 pt"
    );
    assert.ok(shortProductTitle({ name: "Talenti Gelato Non-GMO Black Raspberry Chocolate Chip Frozen Dessert Gluten-Free, 1 Pint 1 Count", brand: "Talenti", size: "1 pint" }).length <= 56);
  });

  it("stages a quantity without leaving 1 to 99", () => {
    assert.equal(stagedQuantity(1, 1), 2);
    assert.equal(stagedQuantity(1, -1), 1);
    assert.equal(stagedQuantity(98, 5), 99);
    assert.equal(stagedQuantity("nope", 1), 2);
  });
});
