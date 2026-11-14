import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { savingsChangeNote, shopperCopy } from "../../public/shopper/calmPlan.js";
import { storeConnectCopy } from "../../public/shopper/storeConnect.js";
import { learnedSummaryHtml, meatPreferenceHtml } from "../../public/shopper/receiptCopy.js";
import { foodMatchScore, rankFoodMatches, similarQueries, UNAVAILABLE_MATCH } from "../../public/shopper/matchSheet.js";
import { productDisplayName } from "../../public/shopper/matchSheet.js";
import { dedupeStores } from "../../public/shopper/reviewPlans.js";
import { readUsuals, toggleStarredUsual, usualKey } from "../../public/shopper/usuals.js";
import { categoryGateHtml } from "../../public/shopper/categoryStage.js";
import { favoriteWizardSteps } from "../../public/shopper/categoryPreference.js";
import { pickerTileHtml } from "../../public/shopper/themedListsUi.js";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("v93 walkthrough", () => {
  it("confirms a connected Kroger account without skip or checkout copy", () => {
    const connected = storeConnectCopy({ stores: ["Kroger", "Walmart"], oauthConfigured: true, connected: true });
    assert.equal(connected.body, "Kroger is connected.");
    assert.equal(connected.later, "Continue");
    assert.equal(connected.walmart, "");
    assert.equal(connected.showNow, false);
  });

  it("keeps meat preference off the receipt summary", () => {
    const meat = learnedSummaryHtml([{ family: "ground-beef", label: "Ground beef", mode: "cheapest" }], {
      lines: [{ name: "Ground Beef", price: 5.99 }],
    });
    assert.doesNotMatch(meat, /This receipt includes meat/);
    assert.doesNotMatch(meat, /Not on this receipt/);
    assert.doesNotMatch(meat, /Leave Meat/);
    assert.match(meat, /We'll find it for less/);
    assert.match(meat, /basket-promise/);
    assert.match(meatPreferenceHtml(""), /data-meat-pref/);
  });

  it("explains a savings drop against the same list", () => {
    assert.equal(savingsChangeNote(4, 4), "");
    assert.equal(savingsChangeNote(1, 2), "");
    assert.match(savingsChangeNote(3, 1.5), /\$1\.50 less/);
    assert.match(savingsChangeNote(3, 1.5), /same items at one store/);
  });

  it("hides seeded-store wording", () => {
    assert.equal(
      shopperCopy("Kroger prices are for a seeded store, not ZIP 45103 yet. The ingestion job prices a new ZIP on its next pass."),
      "Some prices aren't ready for your ZIP yet."
    );
  });

  it("ranks a Kroger large white egg staple ahead of other eggs", () => {
    const ranked = rankFoodMatches(
      [
        { id: "cooker", name: "Egg cooker", brand: "Dash" },
        { id: "brown", name: "Large Brown Eggs", brand: "Eggland's Best", sizeLabel: "12 ct" },
        { id: "kroger", name: "Grade A Large White Eggs", brand: "Kroger", sizeLabel: "12 ct" },
        { id: "pulp", name: "Egg carton pulp packaging" },
      ],
      "eggs",
      "Kroger large white eggs"
    );
    assert.equal(ranked[0].id, "kroger");
    assert.equal(foodMatchScore(ranked[0], "Kroger large white eggs") > foodMatchScore(ranked[1], "Kroger large white eggs"), true);
    assert.equal(ranked.some((item) => item.id === "pulp"), false);
    assert.equal(ranked.some((item) => item.id === "cooker"), false);
  });

  it("offers a similar search when a name is missing", () => {
    assert.equal(UNAVAILABLE_MATCH, "Not currently available at your stores.");
    assert.deepEqual(similarQueries("Lysol"), ["disinfectant", "cleaner"]);
  });

  it("keeps flavor in front of the product name", () => {
    assert.equal(
      productDisplayName({ name: "Coca-Cola", brand: "Coca-Cola", flavorLabel: "Cherry", sizeLabel: "12 pk" }, { flavorLabel: "Cherry", sizeLabel: "12 pk" }),
      "Cherry Coca-Cola 12 pk"
    );
  });

  it("does not add the same line twice when both stores priced it", () => {
    const stores = dedupeStores([
      { storeName: "Kroger", items: [{ lineId: "a", name: "Milk", upc: "00012345678905", quantity: 2, price: 3, storeName: "Kroger" }] },
      { storeName: "Walmart", items: [{ lineId: "b", name: "Milk", upc: "00012345678905", quantity: 2, price: 3.2, storeName: "Walmart" }] },
    ]);
    const units = stores.reduce((sum, store) => sum + store.items.reduce((inner, item) => inner + item.quantity, 0), 0);
    assert.equal(units, 2);
  });

  it("stars each flavor separately", () => {
    const storage = memory();
    assert.equal(toggleStarredUsual(storage, { name: "Cherry Coke", catalogId: "coke", flavor: "Cherry", size: "12 pk" }), true);
    assert.equal(toggleStarredUsual(storage, { name: "Diet Coke", catalogId: "coke", flavor: "Diet", size: "12 pk" }), true);
    assert.notEqual(
      usualKey({ catalogId: "coke", name: "Cherry Coke", flavor: "Cherry", size: "12 pk" }),
      usualKey({ catalogId: "coke", name: "Diet Coke", flavor: "Diet", size: "12 pk" })
    );
    assert.equal(readUsuals(storage).filter((row) => row.starred).length, 2);
  });

  it("labels a category as Buying or Left off", () => {
    const html = categoryGateHtml({ categories: [{ id: "milk", label: "Milk" }, { id: "eggs", label: "Eggs" }], declined: ["eggs"] });
    assert.match(html, /Milk/);
    assert.match(html, /Buying/);
    assert.match(html, /Left off/);
    assert.match(html, /data-gate="eggs"[^>]*aria-pressed="true"/);
    assert.doesNotMatch(html, /Tap a category you never buy/);
  });

  it("offers one Store brand instead of each store's brand", () => {
    const eggs = favoriteWizardSteps().find((step) => step.id === "eggs");
    assert.ok(eggs);
    assert.equal(eggs.brands.some((name) => /kroger|great value|simple truth/i.test(name)), false);
  });

  it("labels only the current size in a picker", () => {
    const one = pickerTileHtml({ familyKey: "coke", familyName: "Coca-Cola", variants: [{ id: "12", label: "12 pk", flavorLabel: "Cherry" }] }, "12", (value) => String(value || ""), (url) => url);
    assert.match(one, /Current selection/);
    assert.doesNotMatch(one, /data-pick-size/);
    const many = pickerTileHtml(
      {
        familyKey: "coke",
        familyName: "Coca-Cola",
        variants: [
          { id: "12", label: "12 pk" },
          { id: "6", label: "6 pk" },
        ],
      },
      "12",
      (value) => String(value || ""),
      (url) => url
    );
    assert.equal((many.match(/aria-checked="true"/g) || []).length, 1);
    assert.match(many, /Current selection 12 pk/);
  });
});
