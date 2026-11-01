import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyProfile } from "../../public/shopper/profile.js";
import {
  isPreferenceList,
  learnCategoryFromProduct,
  nameBrandsFor,
  parseNeedItems,
  resolveCategoryPreference,
  resolveNeedList,
  setCategoryPreference,
} from "../../public/shopper/categoryPreference.js";
import { fewerStorePlan, handoffMark } from "../../public/shopper/tripPlan.js";

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
    offers: extra.offers || [{ storeName: extra.store || "Walmart", price: extra.price }],
  };
}

describe("category preferences", () => {
  const eggs = [
    product("eb", "Large Eggs", "Eggland's Best", { subcategory: "Eggs", sizeLabel: "12 ct", price: 5.48 }),
    product("gv", "Large Eggs", "Great Value", { subcategory: "Eggs", sizeLabel: "12 ct", price: 1.2, storeBrand: true, store: "Walmart" }),
    product("kr", "Large Eggs", "Kroger", { subcategory: "Eggs", sizeLabel: "18 ct", price: 3.18, storeBrand: true, store: "Kroger" }),
  ];

  it("resolves name brand, store brand, and cheapest without inventing a price", () => {
    const brand = resolveCategoryPreference({
      profile: setCategoryPreference(emptyProfile(), { family: "eggs", mode: "brand", brand: "Eggland's Best", productId: "eb" }),
      family: "eggs",
      products: eggs,
    });
    assert.equal(brand.product?.id, "eb");
    const store = resolveCategoryPreference({
      profile: setCategoryPreference(emptyProfile(), { family: "eggs", mode: "storeBrand" }),
      family: "eggs",
      products: eggs,
      storeName: "Kroger",
    });
    assert.equal(store.product?.id, "kr");
    const cheap = resolveCategoryPreference({
      profile: setCategoryPreference(emptyProfile(), { family: "eggs", mode: "cheapest" }),
      family: "eggs",
      products: eggs,
    });
    assert.equal(cheap.product?.id, "gv");
    const unpriced = resolveCategoryPreference({
      profile: setCategoryPreference(emptyProfile(), { family: "eggs", mode: "cheapest" }),
      family: "eggs",
      products: eggs.map((item) => ({ ...item, price: undefined, offers: [] })),
    });
    assert.equal(unpriced.product, null);
    assert.equal(unpriced.ask, true);
  });

  it("leaves off a family they don't buy and asks only when nothing is saved", () => {
    const profile = setCategoryPreference(emptyProfile(), { family: "steak", mode: "never" });
    const list = resolveNeedList({
      profile,
      text: "I need bread, milk, eggs, bacon, steak, chili, cilantro",
      products: [
        product("bread", "White Sandwich Bread", "Nature's Own", { departmentId: "bakery", subcategory: "Bread", price: 3 }),
        product("milk", "Whole Milk", "Dairy Pure", { subcategory: "Milk", sizeLabel: "1 gal", price: 3.18 }),
        ...eggs,
        product("bacon", "Thick Cut Bacon", "Oscar Mayer", { departmentId: "meat-seafood", subcategory: "Pork", sizeLabel: "16 oz", price: 6 }),
        product("steak", "Ribeye Steak", "USDA Choice", { departmentId: "meat-seafood", subcategory: "Beef", price: 14 }),
        product("chili", "Chili with Beans", "Hormel", { departmentId: "pantry", subcategory: "Canned", sizeLabel: "15 oz", price: 2.5 }),
        product("herb", "Cilantro", "Fresh", { departmentId: "produce", subcategory: "Fresh Herbs", price: 0.99 }),
      ],
    });
    assert.equal(isPreferenceList("I need bread, milk, eggs, bacon, steak, chili, cilantro"), true);
    assert.deepEqual(parseNeedItems("bread, milk, eggs").map((item) => item.family), ["bread", "milk", "eggs"]);
    const pastries = parseNeedItems("I need cinnamon pop-tarts and cherry pop-tarts");
    assert.deepEqual(
      pastries.map((item) => item.raw),
      ["cinnamon pop-tarts", "cherry pop-tarts"]
    );
    assert.deepEqual(
      parseNeedItems("cinnamon and cherry pop-tarts").map((item) => item.raw),
      ["cinnamon pop-tarts", "cherry pop-tarts"]
    );
    assert.equal(list.added.some((row) => row.family === "steak"), false);
    assert.ok(list.skipped.some((row) => row.family === "steak" && row.declined));
    assert.ok(list.ask.some((row) => row.family === "bread"));
  });

  it("learns a brand from Change and lists real name brands only", () => {
    const learned = learnCategoryFromProduct(emptyProfile(), eggs[0]);
    assert.equal(learned.categoryPreferences.eggs.mode, "brand");
    assert.equal(learned.categoryPreferences.eggs.brand, "Eggland's Best");
    const names = nameBrandsFor(eggs, "eggs").map((row) => row.brand);
    assert.deepEqual(names, ["Eggland's Best"]);
    assert.equal(names.includes("Great Value"), false);
  });

  it("prices fewer stores against the split and marks cart versus list", () => {
    const milk = {
      lineId: "milk",
      name: "Whole Milk",
      price: 2.48,
      quantity: 1,
      itemTotal: 2.48,
      storeName: "Aldi",
      offers: [
        { storeName: "Aldi", price: 2.48 },
        { storeName: "Walmart", price: 3.18 },
        { storeName: "Kroger", price: 3.29 },
      ],
    };
    const eggsLine = {
      lineId: "eggs",
      name: "Large Eggs",
      price: 1.89,
      quantity: 1,
      itemTotal: 1.89,
      storeName: "Target",
      offers: [
        { storeName: "Target", price: 1.89 },
        { storeName: "Walmart", price: 2.14 },
        { storeName: "Kroger", price: 3.18 },
      ],
    };
    const spread = [
      { storeName: "Aldi", subtotal: 2.48, items: [milk], handoff: { tier: "link" } },
      { storeName: "Target", subtotal: 1.89, items: [eggsLine], handoff: { tier: "link" } },
    ];
    const fewer = fewerStorePlan(spread, {});
    assert.ok(fewer.stops <= 2);
    assert.ok(fewer.stores.every((store) => store.storeName === "Walmart" || store.storeName === "Kroger"));
    assert.ok(fewer.delta > 0);
    assert.equal(handoffMark({ storeName: "Kroger", handoff: { tier: "cart", action: { type: "kroger_cart" } } }).label, "Cart");
    assert.equal(handoffMark({ storeName: "Target", handoff: { tier: "link" } }).label, "List");
  });
});
