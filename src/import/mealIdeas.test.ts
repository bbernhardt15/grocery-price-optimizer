import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoBrowseProducts } from "../catalog/demoCatalog";
import { matchImportItems } from "./matchImport";
import { mealFromAsk, mealPreviews } from "./mealIdeas";
import { describeMeal, mealPreviews as clientPreviews } from "../../public/shopper/mealIdeas.js";

function pickedName(search: string): string {
  const plan = mealFromAsk("taco night");
  assert.ok(plan);
  const item = plan.items.find((row) => row.name === search) ?? { raw: search, name: search, quantity: 1 };
  const result = matchImportItems([item], demoBrowseProducts());
  const choice = result.items[0]?.choices.find((row) => row.product.id === result.items[0]?.selectedId);
  return `${result.items[0]?.status} ${choice?.product.catalogName || choice?.product.familyName || choice?.product.name || ""}`;
}

describe("meal ideas", () => {
  it("keeps the ask-box preview on the same meals as the server", () => {
    assert.deepEqual(clientPreviews(), mealPreviews());
    for (const phrase of ["taco night for 6", "breakfast for four", "I want a cookout for 8 people", "movie night tonight", "lunch"]) {
      const server = mealFromAsk(phrase);
      const client = describeMeal(phrase);
      assert.ok(server);
      assert.equal(client?.title, server.idea.title);
      assert.equal(client?.people, server.idea.people);
      assert.equal(client?.namedPeople, server.idea.namedPeople);
      assert.equal(client?.blurb, server.idea.blurb);
    }
  });

  it("turns taco night for 6 into packs, and leaves a grocery list alone", () => {
    const meal = mealFromAsk("taco night for 6");
    assert.ok(meal);
    assert.equal(meal.idea.title, "Taco night");
    assert.equal(meal.idea.namedPeople, true);
    assert.deepEqual(
      meal.items.map((item) => [item.raw, item.name, item.quantity]),
      [
        ["Ground beef", "ground beef", 2],
        ["Tortillas", "flour tortillas", 2],
        ["Salsa", "mild salsa", 2],
        ["Cheese", "shredded cheddar", 2],
        ["Chips", "potato chips", 2],
      ]
    );
    assert.equal(mealFromAsk("milk, eggs, bread"), null);
    assert.equal(mealFromAsk("ground beef"), null);
    assert.equal(mealFromAsk("wings"), null);
    assert.equal(mealFromAsk("I need milk eggs bread and juice"), null);
    assert.equal(describeMeal("milk, eggs, bread"), null);
  });

  it("scales a cookout and still matches each ingredient to that food", () => {
    const cookout = mealFromAsk("let's do a cookout for 8");
    assert.ok(cookout);
    assert.equal(cookout.idea.people, 8);
    const beef = cookout.items.find((item) => item.name === "ground beef");
    const buns = cookout.items.find((item) => item.name === "burger buns");
    const soda = cookout.items.find((item) => item.name === "coca-cola");
    assert.equal(beef?.quantity, 2);
    assert.equal(buns?.quantity, 1);
    assert.equal(soda?.quantity, 2);

    const expect: Array<[string, RegExp, RegExp?]> = [
      ["ground beef", /ground beef/i, /hot dog/i],
      ["flour tortillas", /tortilla/i, /chip/i],
      ["mild salsa", /salsa/i],
      ["shredded cheddar", /cheddar/i, /dorito/i],
      ["potato chips", /potato chip/i, /dorito|chocolate/i],
      ["burger buns", /burger bun/i, /hot dog/i],
      ["coca-cola", /coca-cola/i, /diet|pepsi/i],
      ["ketchup", /ketchup/i],
      ["chicken breast", /chicken breast/i, /wing/i],
      ["spaghetti", /spaghetti/i],
      ["baby spinach", /spinach/i],
      ["sandwich bread", /sandwich bread/i, /bagel/i],
      ["large eggs", /egg/i],
      ["whole milk", /whole milk/i, /chocolate/i],
      ["bananas", /banana/i],
      ["ground coffee", /coffee/i],
      ["orange juice", /orange juice/i],
      ["microwave popcorn", /popcorn/i],
      ["milk chocolate", /chocolate bar/i, /chip|oreo/i],
      ["vanilla ice cream", /vanilla ice cream/i, /oreo/i],
      ["chicken wings", /wing/i, /breast/i],
      ["ranch dip", /ranch/i],
      ["oreo", /oreo/i, /ice cream/i],
      ["vanilla cake mix", /cake mix/i],
      ["paper plates", /plate/i],
      ["sliced turkey", /turkey breast/i, /whole turkey/i],
      ["gala apples", /apple/i],
      ["all-purpose flour", /flour/i],
      ["granulated sugar", /sugar/i],
      ["salted butter", /salted butter/i, /peanut/i],
      ["semi-sweet chocolate chips", /chocolate chip/i, /potato|oreo/i],
      ["whole turkey", /whole turkey/i, /breast/i],
      ["stuffing mix", /stuffing/i],
      ["cranberry sauce", /cranberry/i],
      ["russet potatoes", /potato/i, /chip/i],
      ["dinner rolls", /dinner roll/i],
      ["green beans", /green bean/i],
      ["pie crust", /pie crust/i],
      ["whipped topping", /whipped/i],
    ];
    for (const [search, want, avoid] of expect) {
      const got = pickedName(search);
      assert.match(got, /^(matched|ambiguous) /);
      assert.match(got, want, search);
      if (avoid) assert.doesNotMatch(got, avoid, `${search} → ${got}`);
    }
  });
});
