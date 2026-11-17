import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { browseDepartment, mapToDepartment, reportAisleMismatches } from "../catalog/departments";
import { flavorWanted, preferFlavorFromQuery } from "../catalog/family";
import { groceryLeaves } from "../ingest/walmartWalk";
import { namesMatch } from "../guide/rules";
import { productDisplayName } from "../../public/shopper/matchSheet.js";
import { sizesForFlavor } from "../../public/shopper/import.js";
import { brandsForRule, learnedCardInnerHtml, storeBrandsFor } from "../../public/shopper/receiptCopy.js";
import { receiptRevealDelay } from "../../public/shopper/receiptImport.js";
import { nameBrandsFor } from "../../public/shopper/categoryPreference.js";
import { cartCardFigures } from "../../public/shopper/reviewSettle.js";
import { singleStoreSavings } from "../../public/shopper/tripPlan.js";
import { readStarredUsuals, starUsual } from "../../public/shopper/usuals.js";
import { emptyBook, readBook, rememberEverywhere, rememberStarredSlot, writeBook } from "../../public/shopper/themedLists.js";
import { choiceFromProduct } from "../../public/shopper/themedLists.js";

describe("v94 walkthrough", () => {
  it("keeps electronics and health products out of food aisles", () => {
    assert.equal(browseDepartment(undefined, "2-Year AppleCare+ for Apple Watch SE", "produce"), "other");
    assert.equal(browseDepartment(undefined, "***fast Track*** Apple Iphone 4s 8gb Bl", "produce"), "other");
    assert.equal(mapToDepartment(undefined, "Equate Calamine Lotion").departmentId, "personal-care");
    assert.equal(browseDepartment(undefined, "Equate Jock Itch Powder Spray", "dairy-eggs"), "personal-care");
    assert.equal(browseDepartment(undefined, "ALFLEXIL Pain Relief Roll-On", "dairy-eggs"), "personal-care");
    assert.equal(browseDepartment(undefined, "Bananas", "produce"), "produce");
    assert.equal(browseDepartment(undefined, "Kroger Grade A Large White Eggs 12 ct", "dairy-eggs"), "dairy-eggs");
    const leaves = groceryLeaves({
      categories: [
        { id: "apple", name: "Apple", path: "Apple", children: [] },
        { id: "apples", name: "Apples", path: "Food/Produce/Apples", children: [] },
      ],
    });
    assert.deepEqual(leaves.map((leaf) => leaf.id), ["apples"]);
    const mismatches = reportAisleMismatches([
      { name: "2-Year AppleCare+ for Apple Watch SE", departmentId: "produce" },
      { name: "Equate Calamine Lotion", departmentId: "dairy-eggs" },
      { name: "Bananas", departmentId: "produce" },
    ]);
    assert.equal(mismatches.length, 2);
    assert.equal(mismatches[0]?.mapped, "other");
    assert.equal(mismatches[1]?.mapped, "personal-care");
  });

  it("uses one line total for Everything at Kroger and the store row", () => {
    const items = [
      {
        name: "Milk",
        storeName: "Kroger",
        quantity: 2,
        price: 3.49,
        itemTotal: 6.98,
        offers: [{ storeName: "Kroger", price: 1.2 }],
      },
      {
        name: "Eggs",
        storeName: "Kroger",
        quantity: 1,
        price: 4.29,
        itemTotal: 4.29,
        offers: [{ storeName: "Kroger", price: 4.29 }],
      },
    ];
    const comparison = singleStoreSavings(items);
    const figures = cartCardFigures([{ storeName: "Kroger", subtotal: 265.07, items }]);
    assert.equal(comparison.singleStore?.storeName, "Kroger");
    assert.equal(comparison.singleStore?.total, 11.27);
    assert.equal(figures.stores[0]?.subtotal, comparison.singleStore?.total);
  });

  it("stars a remembered themed pick and remembers a starred egg", () => {
    const storage = new Map<string, string>();
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    const choice = choiceFromProduct({ id: "kroger-eggs", name: "Kroger Large White Eggs", brand: "Kroger", familyName: "Large Eggs" });
    writeBook(memory, rememberEverywhere(emptyBook(), "holiday", "eggs", choice, 1));
    starUsual(memory, { name: "Large Eggs", brand: "Kroger", catalogId: "kroger-eggs" }, 2);
    assert.equal(readStarredUsuals(memory).length, 1);
    assert.equal(readBook(memory).favorites.eggs?.brand, "Kroger");
    const starred = rememberStarredSlot(emptyBook(), { name: "Salted Butter", brand: "Kroger", id: "butter" }, 3);
    assert.equal(starred.favorites.butter?.brand, "Kroger");
  });

  it("preselects Cherry over Diet Cherry and keeps the title clean", () => {
    assert.equal(flavorWanted("Cherry coke"), "cherry");
    assert.equal(flavorWanted("diet cherry coke"), "diet cherry");
    const tile = preferFlavorFromQuery(
      {
        defaultVariantId: "diet",
        flavorLabel: "Diet Cherry",
        variants: [
          { id: "diet", flavorKey: "diet cherry", flavorLabel: "Diet Cherry" },
          { id: "cherry", flavorKey: "cherry", flavorLabel: "Cherry" },
        ],
      },
      "Cherry coke"
    );
    assert.equal(tile.defaultVariantId, "cherry");
    assert.equal(
      productDisplayName(
        { familyName: "Coke", flavorLabel: "Cherry" },
        { name: "Cherry Diet Cherry Pop Coca-Cola Regular", flavorLabel: "Cherry", sizeLabel: "12 pk" }
      ),
      "Cherry Coke 12 pk"
    );
  });

  it("limits import sizes to the chosen Oreo flavor", () => {
    const sizes = sizesForFlavor({
      flavorKey: "double stuf",
      variants: [
        { id: "stuf", flavorKey: "double stuf", label: "14.3 oz" },
        { id: "mini", flavorKey: "mini", label: "Mini" },
        { id: "thins", flavorKey: "thins", label: "Thins" },
      ],
    });
    assert.deepEqual(sizes.map((row) => row.id), ["stuf"]);
  });

  it("treats Double Stuf and Double-stuff Oreos as the same list item", () => {
    assert.equal(namesMatch("Double Stuf Oreos", "Double-stuff Oreos"), true);
    assert.equal(namesMatch("Milk", "Cookies"), false);
  });

  it("lists name brands only on the name-brand rule and hides I don't buy it on learned food", () => {
    const bananas = learnedCardInnerHtml(
      { family: "bananas", label: "Bananas", mode: "brand" },
      { editing: true, brands: ["Kroger", "Simple Truth", "Great Value", "Chiquita"] }
    );
    assert.equal(bananas.includes("Kroger"), false);
    assert.equal(bananas.includes("Simple Truth"), false);
    assert.equal(bananas.includes("Great Value"), false);
    assert.match(bananas, /Chiquita/);
    assert.match(bananas, /Name brands only/);
    assert.equal(bananas.includes("I don't buy it"), false);
    assert.equal(bananas.includes("Store brand only"), false);
    const lettuce = learnedCardInnerHtml(
      { family: "lettuce", label: "Lettuce", mode: "brand" },
      { editing: true, brands: ["Great Value", "Dole"], stores: ["Kroger"] }
    );
    assert.equal(lettuce.includes("Great Value"), false);
    assert.match(lettuce, /Dole/);
    const krogerOnly = storeBrandsFor(["Kroger"]);
    assert.equal(krogerOnly.includes("Great Value"), false);
    assert.ok(krogerOnly.includes("Kroger"));
    assert.deepEqual(brandsForRule(["Chiquita", "Kroger", "Great Value"], "brand", ["Kroger"]), ["Chiquita"]);
    assert.deepEqual(brandsForRule(["Chiquita", "Kroger", "Great Value"], "storeBrand", ["Kroger"]), ["Kroger"]);
    const cheapest = learnedCardInnerHtml(
      { family: "bananas", label: "Bananas", mode: "cheapest" },
      { editing: true, brands: ["Chiquita", "Kroger"], stores: ["Kroger"] }
    );
    assert.equal(cheapest.includes("brand-pick"), false);
    assert.equal(cheapest.includes("store-brand-note"), false);
    const meat = learnedCardInnerHtml({ family: "meat", label: "Meat", mode: "storeBrand" }, { editing: true, brands: [] });
    assert.match(meat, /I don't buy it/);
  });

  it("keeps the receipt reading step on screen and does not share a parse across sessions", () => {
    assert.equal(receiptRevealDelay(1_000, 1_200), 1300);
    assert.equal(receiptRevealDelay(1_000, 3_000), 0);
    const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
    const route = readFileSync(new URL("../../src/routes/importList.ts", import.meta.url), "utf8");
    assert.match(app, /x-device-id": deviceId\(\)/);
    assert.match(route, /photo:\$\{clientKey\(req, res\)\}/);
    assert.match(route, /pdf:\$\{clientKey\(req, res\)\}/);
  });

  it("keeps brand chip order stable", () => {
    const products = [
      { id: "bull", name: "Bull's Eye BBQ Sauce", brand: "Bull's Eye", departmentId: "pantry" },
      { id: "ray", name: "Sweet Baby Ray's BBQ Sauce", brand: "Sweet Baby Ray's", departmentId: "pantry" },
    ];
    const first = nameBrandsFor(products, "bbq-sauce").map((row) => row.brand);
    const again = nameBrandsFor(products, "bbq-sauce").map((row) => row.brand);
    assert.deepEqual(again, first);
    assert.equal(first[0], "Bull's Eye");
    assert.notEqual(first.at(-1), "Bull's Eye");
  });

  it("does not overlay the price check and lays the match star in the row", () => {
    const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
    const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
    assert.match(css, /\.shop-checking-banner \{[^}]*position: static/);
    assert.match(app, /flowStep === \"shop\"/);
    assert.match(css, /\.match-star \{ position: static/);
    assert.match(app, /shop-checking-banner/);
    assert.match(app, /function goHome\(\) \{[\s\S]*if \(typed\) \{\s*query = "";\s*browseOpen = false/);
    assert.match(app, /searchTiles:[\s\S]*rankFoodMatches/);
  });
});
