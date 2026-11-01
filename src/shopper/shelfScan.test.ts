import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { emptyProfile } from "../../public/shopper/profile.js";
import { setCategoryPreference } from "../../public/shopper/categoryPreference.js";
import {
  SHELF_EMPTY,
  SHELF_LANES,
  SHELF_PRIVACY,
  addMissed,
  applyShelfPreferences,
  defaultChoice,
  mergeShelfItems,
  neededText,
  readShelfPhotos,
  removeShelfItem,
  shelfHomeHtml,
  shelfProgressLabel,
  shelfResultsHtml,
  withChoice,
} from "../../public/shopper/shelfScan.js";

function product(id: string, name: string, brand: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    brand,
    departmentId: extra.departmentId || "dairy-eggs",
    subcategory: extra.subcategory,
    sizeLabel: extra.sizeLabel,
    price: extra.price,
    storeBrand: extra.storeBrand,
    offers: extra.offers || [{ storeName: extra.store || "Kroger", price: extra.price }],
  };
}

function scanRow(family: string, fullness: string, confidence = "high") {
  return { name: family, family, confidence, fullness };
}

describe("shelf scan list rules", () => {
  const products = [
    product("eb", "Large Eggs", "Eggland's Best", { subcategory: "Eggs", sizeLabel: "12 ct", price: 5.48 }),
    product("gv-eggs", "Large Eggs", "Great Value", { subcategory: "Eggs", sizeLabel: "12 ct", price: 1.2, storeBrand: true }),
    product("milk-brand", "Whole Milk", "Dairy Pure", { subcategory: "Milk", sizeLabel: "1 gal", price: 3.49 }),
    product("land", "Salted Butter", "Land O Lakes", { subcategory: "Butter", sizeLabel: "16 oz", price: 5.29 }),
    product("kr-butter", "Salted Butter", "Kroger", { subcategory: "Butter", sizeLabel: "16 oz", price: 3.99, storeBrand: true, store: "Kroger" }),
    product("gv-butter", "Salted Butter", "Great Value", { subcategory: "Butter", sizeLabel: "16 oz", price: 2.49, storeBrand: true, store: "Walmart" }),
    product("heinz", "Tomato Ketchup", "Heinz", { departmentId: "pantry", subcategory: "Condiments", sizeLabel: "20 oz", price: 3.5 }),
    product("cheap-ketchup", "Tomato Ketchup", "Hunt's", { departmentId: "pantry", subcategory: "Condiments", sizeLabel: "20 oz", price: 1.25 }),
    product("cheese", "Mild Cheddar Cheese", "Kraft", { subcategory: "Cheese", sizeLabel: "8 oz", price: 3.29 }),
    product("bread", "White Sandwich Bread", "Nature's Own", { departmentId: "bakery", subcategory: "Bread", sizeLabel: "20 oz", price: 3 }),
    product("bananas", "Bananas", "Fresh", { departmentId: "produce", subcategory: "Fruit", price: 0.5 }),
    product("coffee", "Ground Coffee", "Folgers", { departmentId: "pantry", subcategory: "Coffee & Tea", sizeLabel: "12 oz", price: 6 }),
  ];

  it("preselects low and empty, and leaves an unknown fill for the shopper", () => {
    const rows = mergeShelfItems([
      [scanRow("milk", "low"), scanRow("milk", "full", "low")],
      [scanRow("eggs", "empty"), scanRow("butter", "half"), scanRow("ketchup", "unknown", "low"), scanRow("cheese", "full")],
    ]);
    const choice = Object.fromEntries(rows.map((row) => [row.family, row.choice]));
    assert.equal(choice.milk, "low");
    assert.equal(rows.find((row) => row.family === "milk")?.unsure, true);
    assert.equal(choice.eggs, "out");
    assert.equal(choice.butter, "enough");
    assert.equal(choice.ketchup, "");
    assert.equal(choice.cheese, "enough");
    assert.equal(defaultChoice({ fullness: "unknown" }), "");
    assert.equal(neededText(rows), "Milk, Eggs");
    const changed = withChoice(rows, "ketchup", "low");
    assert.equal(neededText(changed), "Milk, Eggs, Ketchup");
    assert.equal(neededText(removeShelfItem(changed, "eggs")).includes("Eggs"), false);
  });

  it("applies saved brand, store brand, and cheapest, and asks when nothing is saved", () => {
    let profile = emptyProfile();
    profile = setCategoryPreference(profile, { family: "eggs", mode: "brand", brand: "Eggland's Best", productId: "eb" });
    profile = setCategoryPreference(profile, { family: "butter", mode: "storeBrand" });
    profile = setCategoryPreference(profile, { family: "ketchup", mode: "cheapest" });
    profile = setCategoryPreference(profile, { family: "cheese", mode: "never" });
    profile = setCategoryPreference(profile, { family: "coffee", mode: "skip" });
    const rows = [
      ...mergeShelfItems([[scanRow("eggs", "low"), scanRow("butter", "low"), scanRow("ketchup", "empty"), scanRow("cheese", "empty"), scanRow("bananas", "low"), scanRow("coffee", "empty")]]),
      ...addMissed([], "bread").added.map((row) => ({ ...row, choice: "enough" as const })),
    ];
    assert.equal(neededText(rows).includes("Bread"), false);
    const applied = applyShelfPreferences({ profile, rows, products });
    const added = Object.fromEntries(applied.added.map((row) => [row.family, row.product?.id]));
    assert.equal(added.eggs, "eb");
    assert.equal(applied.added.find((row) => row.family === "butter")?.product?.storeBrand, true);
    assert.notEqual(added.butter, "land");
    assert.equal(added.ketchup, "cheap-ketchup");
    assert.equal(added.cheese, undefined);
    assert.equal(added.bread, undefined);
    assert.ok(applied.skipped.some((row) => row.family === "cheese" && row.declined));
    assert.ok(applied.ask.some((row) => row.family === "bananas"));
    assert.ok(applied.ask.some((row) => row.family === "coffee"));
    assert.equal(applied.added.some((row) => row.family === "bananas" || row.family === "coffee"), false);
  });

  it("treats allergies and diets as hard exclusions, ahead of a saved brand", () => {
    let profile = emptyProfile();
    profile = { ...profile, allergies: ["milk", "egg"], diets: ["gluten-free"] };
    profile = setCategoryPreference(profile, { family: "eggs", mode: "brand", brand: "Eggland's Best", productId: "eb" });
    profile = setCategoryPreference(profile, { family: "milk", mode: "brand", brand: "Dairy Pure", productId: "milk-brand" });
    profile = setCategoryPreference(profile, { family: "bread", mode: "cheapest" });
    profile = setCategoryPreference(profile, { family: "ketchup", mode: "cheapest" });
    const rows = mergeShelfItems([[scanRow("milk", "empty"), scanRow("eggs", "low"), scanRow("bread", "low"), scanRow("ketchup", "low")]]);
    const applied = applyShelfPreferences({ profile, rows, products });
    assert.deepEqual(
      applied.added.map((row) => row.family),
      ["ketchup"]
    );
    assert.equal(applied.added[0]?.product?.id, "cheap-ketchup");
    for (const family of ["milk", "eggs", "bread"]) {
      assert.ok(applied.skipped.some((row) => row.family === family && row.excluded));
      assert.equal(applied.added.some((row) => row.family === family), false);
    }
  });

  it("adds a missed staple as something to buy and ignores a word that is not one", () => {
    const first = addMissed([], "yogurt, a blender");
    assert.deepEqual(first.added.map((row) => row.family), ["yogurt"]);
    assert.equal(first.added[0]?.choice, "out");
    assert.deepEqual(first.missed, ["blender"]);
    const again = addMissed(first.rows, "yogurt");
    assert.equal(again.added.length, 0);
  });

  it("reads photos a few at a time and reports the real step", async () => {
    assert.equal(shelfProgressLabel({ photo: 2, photos: 3, part: 1, parts: 2 }), "Reading photo 2 of 3, part 1 of 2…");
    assert.equal(shelfProgressLabel({ photo: 1, photos: 1, part: 2, parts: 4 }), "Reading part 2 of 4…");
    assert.equal(SHELF_LANES, 4);
    const messages: string[] = [];
    let active = 0;
    let peak = 0;
    const result = await readShelfPhotos(
      {
        photo: true,
        lanes: SHELF_LANES,
        prepare: async () => [{ size: 10, type: "image/jpeg" }],
        onProgress: (event: { message?: string }) => {
          if (event.message) messages.push(event.message);
        },
        postPhoto: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active -= 1;
          return { items: [{ name: "Milk", family: "milk", confidence: "high", fullness: "low" }] };
        },
      },
      [1, 2, 3, 4, 5, 6]
    );
    assert.ok(peak <= SHELF_LANES);
    assert.ok(peak > 1);
    assert.ok(messages.includes("Preparing…"));
    assert.ok(messages.includes("Preparing photo 2 of 6…"));
    assert.ok(messages.includes("Reading photo 1 of 6…"));
    assert.equal(result.items[0]?.family, "milk");
    assert.equal(result.items[0]?.choice, "low");
    assert.equal(result.error, "");

    const empty = await readShelfPhotos(
      {
        photo: true,
        prepare: async () => [{ size: 10 }],
        postPhoto: async () => ({ items: [{ name: "blurry jar" }] }),
      },
      [{}]
    );
    assert.equal(empty.error, SHELF_EMPTY);
    const refused = await readShelfPhotos(
      {
        photo: true,
        prepare: async () => [{ size: 10 }],
        postPhoto: async () => {
          const error = new Error("Photo reading was refused. The vision key on the server is invalid and needs to be replaced.");
          (error as { code?: string }).code = "unauthorized";
          throw error;
        },
      },
      [{}]
    );
    assert.match(refused.error, /vision key/);
  });

  it("puts the scan on the Add tab and does not talk about meals", () => {
    const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
    const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
    const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    const client = readFileSync(new URL("../../public/shopper/shelfScan.js", import.meta.url), "utf8");
    assert.match(html, /id="shelf-scan"[^>]*>Scan fridge or pantry/);
    assert.match(html, /id="shelf-scan-off"/);
    assert.match(html, /Fridge and pantry scan needs photo reading/);
    assert.match(app, /mountShelfScan/);
    assert.match(app, /addFromPreferences/);
    assert.match(sw, /grocery-gitter-shell-v28/);
    assert.match(client, /capture="environment"/);
    assert.match(client, /accept="image\/\*" multiple/);
    assert.match(client, /imageBlobs/);
    const home = shelfHomeHtml();
    const results = shelfResultsHtml([
      { family: "ketchup", label: "Ketchup", name: "Ketchup", fullness: "unknown", confidence: "low", unsure: true, choice: "" },
    ]);
    assert.match(home, /Take a photo/);
    assert.match(home, /Choose photos/);
    assert.match(results, /Here's what we found|Mark what you need to buy/);
    assert.match(results, /Have enough/);
    assert.match(results, /Running low/);
    assert.match(results, /Out/);
    assert.match(results, /Not sure/);
    assert.match(results, /Add to my list/);
    const found = shelfResultsHtml([
      { family: "yogurt", label: "Yogurt", name: "Yogurt", fullness: "full", confidence: "high", choice: "enough" },
      { family: "bread", label: "Bread", name: "Bread", fullness: "half", confidence: "high", choice: "enough" },
    ]);
    const input = found.match(/<input id="shelf-add"[^>]*>/)?.[0] || "";
    assert.match(input, /value=""/);
    assert.equal(input.includes("Yogurt"), false);
    assert.equal(input.includes("bread"), false);
    assert.equal(
      neededText([
        { family: "yogurt", label: "Yogurt", choice: "enough" },
        { family: "bread", label: "Bread", choice: "enough" },
      ]),
      ""
    );
    assert.match(results, /disabled/);
    assert.match(`${home} ${results}`, new RegExp(SHELF_PRIVACY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(`${home} ${results}`, /recipe|meal|what to cook/i);
  });
});
