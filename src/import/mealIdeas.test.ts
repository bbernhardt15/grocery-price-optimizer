import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { familyFromQuery } from "../../public/shopper/stapleFamilies.js";
import { isPreferenceList } from "../../public/shopper/categoryPreference.js";
import { mealFromAsk, mealPreviews } from "./mealIdeas";
import { describeMeal, mealPlan, mealPreviews as clientPreviews } from "../../public/shopper/mealIdeas.js";

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

  it("turns taco night into staple queries and leaves a grocery list alone", () => {
    const meal = mealFromAsk("taco night for 6");
    const plan = mealPlan("taco night for 6");
    assert.ok(meal);
    assert.ok(plan);
    assert.equal(meal.idea.title, "Taco night");
    assert.equal(meal.idea.namedPeople, true);
    assert.deepEqual(
      meal.items.map((item) => item.name),
      plan.items.map((item) => item.raw)
    );
    assert.deepEqual(
      plan.items.map((item) => item.family),
      ["ground-beef", "cheese", "chips"]
    );
    assert.equal(mealFromAsk("milk, eggs, bread"), null);
    assert.equal(mealFromAsk("ground beef"), null);
    assert.equal(describeMeal("milk, eggs, bread"), null);
    assert.equal(isPreferenceList("bread, milk, eggs, bacon, steak, chili, cilantro"), true);
    assert.equal(describeMeal("bread, milk, eggs, bacon, steak, chili, cilantro"), null);
  });

  it("maps every meal ingredient to that staple family", () => {
    const cookout = mealPlan("let's do a cookout for 8");
    assert.ok(cookout);
    assert.equal(cookout.people, 8);
    for (const preview of mealPreviews()) {
      const plan = mealPlan(preview.aliases[0] || preview.title);
      assert.ok(plan, preview.title);
      for (const item of plan.items) {
        assert.equal(familyFromQuery(item.raw), item.family, `${preview.title}: ${item.raw}`);
      }
    }
  });
});
