import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { familyForSighting, fullnessOf, parseShelfScan, shelfPrompt } from "./shelfScan";

describe("shelf scan parsing", () => {
  it("maps visible staples and drops anything that is not a grocery family", () => {
    const items = parseShelfScan({
      meals: ["omelette", "grilled cheese"],
      recipe: "Use the eggs.",
      items: [
        { name: "milk", confidence: "high", fullness: "low" },
        { name: "eggs", confidence: "high", fullness: "empty" },
        { name: "butter", confidence: "high", fullness: "half" },
        { name: "ketchup", confidence: "low", fullness: "unknown" },
        { name: "cheddar cheese", confidence: "high", fullness: "full" },
        { name: "sandwich bread", confidence: "high", fullness: "running low" },
        { name: "omelette recipe", confidence: "high", fullness: "full" },
        { name: "white appliance", family: "milk", confidence: "high", fullness: "full" },
      ],
    });
    const byFamily = Object.fromEntries(items.map((item) => [item.family, item]));
    assert.deepEqual(Object.keys(byFamily).sort(), ["bread", "butter", "cheese", "eggs", "ketchup", "milk"]);
    assert.equal(byFamily.milk?.fullness, "low");
    assert.equal(byFamily.milk?.confidence, "high");
    assert.equal(byFamily.milk?.unsure, false);
    assert.equal(byFamily.eggs?.fullness, "empty");
    assert.equal(byFamily.butter?.fullness, "half");
    assert.equal(byFamily.ketchup?.confidence, "low");
    assert.equal(byFamily.ketchup?.unsure, true);
    assert.equal(byFamily.ketchup?.fullness, "unknown");
    assert.equal(byFamily.cheese?.label, "Cheese");
    assert.equal(byFamily.cheese?.fullness, "full");
    assert.equal(byFamily.bread?.fullness, "low");
    assert.equal(items.some((item) => /omelette|recipe|appliance/i.test(item.name)), false);
  });

  it("marks a hedged sighting as not sure and keeps one row per family", () => {
    const items = parseShelfScan(
      '```json\n{"items":[{"name":"maybe milk","confidence":"high","fullness":"full"},{"name":"whole milk","confidence":"low","fullness":"empty"},{"name":"Heinz ketchup","confidence":"high","fullness":"half"}]}\n```'
    );
    assert.equal(items.length, 2);
    const milk = items.find((item) => item.family === "milk");
    const ketchup = items.find((item) => item.family === "ketchup");
    assert.equal(milk?.confidence, "low");
    assert.equal(milk?.unsure, true);
    assert.equal(milk?.fullness, "empty");
    assert.equal(ketchup?.family, "ketchup");
    assert.equal(ketchup?.confidence, "high");
    assert.equal(familyForSighting("peanut butter"), "peanut-butter");
    assert.equal(familyForSighting("omelette"), "");
    assert.equal(fullnessOf("almost empty"), "low");
    assert.equal(fullnessOf(""), "unknown");
  });

  it("tells the model to name groceries and not meals", () => {
    const prompt = shelfPrompt();
    assert.match(prompt, /milk, eggs, butter, ketchup, cheese, or bread/);
    assert.match(prompt, /Do not invent items/);
    assert.match(prompt, /Do not suggest meals, recipes, or what to cook/);
    assert.match(prompt, /Milk/);
    assert.match(prompt, /Eggs/);
  });

  it("returns nothing when the picture has no recognizable groceries", () => {
    assert.deepEqual(parseShelfScan({ items: [] }), []);
    assert.deepEqual(parseShelfScan("not json"), []);
    assert.deepEqual(parseShelfScan({ items: [{ name: "blurry jar" }] }), []);
  });
});
