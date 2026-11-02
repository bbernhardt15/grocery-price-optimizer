import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareProductOffers, flavorOverlap, matchRole, requiresOwnHead } from "./productMatch";

describe("matchRole", () => {
  it("treats honey as the product only when the name ends in honey", () => {
    assert.equal(matchRole("Honey", "Kroger Pure Clover Honey"), "product");
    assert.equal(matchRole("Honey", "Sue Bee Clover Honey"), "product");
    assert.equal(matchRole("Honey", "Wildflower Honey"), "product");
    assert.equal(matchRole("Honey", "Honey"), "product");
    assert.equal(matchRole("Honey", "Honey 12 oz Jar"), "product");
  });

  it("demotes honey used as a flavor or ingredient, without a honey-only exception", () => {
    assert.equal(matchRole("Honey", "Honey Nut Cheerios"), "modifier");
    assert.equal(matchRole("Honey", "Honey Nut Cheerios Cereal"), "modifier");
    assert.equal(matchRole("Honey", "Honey Roasted Peanuts"), "modifier");
    assert.equal(matchRole("Honey", "Honey Flavored Greek Yogurt"), "modifier");
    assert.equal(matchRole("Honey", "Honey Bunches of Oats"), "modifier");
    assert.equal(matchRole("Honey", "Honey Mustard"), "modifier");
    assert.equal(matchRole("Honey", "Honeycrisp Apples"), "none");
  });

  it("keeps cuts of the searched food and rejects broth, noodles, and crumbs", () => {
    assert.equal(matchRole("chicken", "Boneless Skinless Chicken Breast"), "product");
    assert.equal(matchRole("chicken", "Chicken Flavored Crackers"), "modifier");
    assert.equal(matchRole("chicken", "Chicken Broth"), "modifier");
    assert.equal(matchRole("milk", "Whole Milk"), "product");
    assert.equal(matchRole("milk", "Chocolate Milk"), "product");
    assert.equal(matchRole("milk", "Milk Chocolate Bar"), "modifier");
    assert.equal(matchRole("peanuts", "Honey Roasted Peanuts"), "product");
    assert.equal(matchRole("peanuts", "Peanut Butter"), "modifier");
    assert.equal(matchRole("eggs", "Large Eggs"), "product");
    assert.equal(matchRole("eggs", "Egg Noodles"), "modifier");
    assert.equal(matchRole("bread", "White Sandwich Bread"), "product");
    assert.equal(matchRole("bread", "Bread Crumbs"), "modifier");
    assert.equal(matchRole("whole milk", "Organic Whole Milk"), "product");
  });

  it("requires the head noun for cream cheese, protein powder, orange juice, and Pop-Tarts", () => {
    assert.equal(requiresOwnHead("cream cheese"), true);
    assert.equal(matchRole("cream cheese", "Philadelphia Original Cream Cheese"), "product");
    assert.equal(matchRole("cream cheese", "Mini Red Velvet Brownies with Cream Cheese Frosting"), "modifier");
    assert.equal(matchRole("protein powder", "Gold Standard Whey Protein Powder"), "product");
    assert.equal(matchRole("protein powder", "Carnation Breakfast Essentials Milk"), "none");
    assert.equal(matchRole("orange juice", "Simply Orange Juice"), "product");
    assert.equal(matchRole("orange juice", "Simply Juice"), "none");
    assert.equal(matchRole("orange juice", "Orange Juice"), "product");
    assert.equal(matchRole("Captain Crunch cereal", "Cap'n Crunch Cereal"), "product");
    assert.equal(matchRole("cinnamon pop-tarts", "Frosted Cherry Pop-Tarts"), "product");
    assert.ok(flavorOverlap("cinnamon pop-tarts", "Frosted Cinnamon Pop-Tarts") > flavorOverlap("cinnamon pop-tarts", "Frosted Cherry Pop-Tarts"));
    const offer = { price: 3, storeName: "Kroger", size: "12 oz" };
    assert.ok(
      compareProductOffers(
        "cream cheese",
        { ...offer, name: "Original Cream Cheese", price: 4 },
        { ...offer, name: "Mini Red Velvet Brownies with Cream Cheese Frosting", price: 2 }
      ) < 0
    );
  });
});
