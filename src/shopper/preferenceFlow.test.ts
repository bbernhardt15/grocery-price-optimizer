import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asksNameBrand, applyCheapestDefaults, nameBrandsFor, parseNeedItems, resolveCategoryPreference, resolveNeedList, setCategoryPreference } from "../../public/shopper/categoryPreference.js";
import { categoryDetailHtml, categoryGateHtml } from "../../public/shopper/categoryStage.js";
import { emptyProfile, parseProfile } from "../../public/shopper/profile.js";
import { productExcluded } from "../../public/shopper/profileConstraints.js";
import { createSilenceWatch } from "../../public/shopper/speechListen.js";
import { isMixedStaple, productMatchesFamily } from "../../public/shopper/stapleFamilies.js";
import { closestProduct, slotById } from "../../public/shopper/themedLists.js";
import { filterTripStores, planningStoreNames } from "../../public/shopper/tripPlan.js";

function product(id: string, name: string, brand: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    brand,
    departmentId: extra.departmentId || "breakfast",
    subcategory: extra.subcategory,
    sizeLabel: extra.sizeLabel,
    imageUrl: extra.imageUrl,
    price: extra.price,
    storeBrand: extra.storeBrand,
    offers: extra.offers || [{ storeName: "Kroger", price: extra.price || 1 }],
  };
}

describe("brand names and category questions", () => {
  it("keeps mode controls and the chosen mode when switching store brand and cheapest", () => {
    const html = categoryDetailHtml({
      category: { id: "milk", label: "Milk" },
      index: 1,
      total: 29,
      mode: "cheapest",
      brand: "Dairy Pure",
      attributes: ["whole"],
      attributeChoices: [
        { id: "whole", label: "Whole" },
        { id: "2%", label: "2%" },
      ],
      brands: [{ brand: "Dairy Pure", imageUrl: "https://img.example/milk.jpg" }],
      askBrand: true,
      produce: false,
    });
    assert.match(html, /2 of 29/);
    assert.match(html, /data-buy="storeBrand"/);
    assert.match(html, /data-buy="cheapest"/);
    assert.match(html, /data-buy="brand"/);
    assert.match(html, /Chosen: Cheapest/);
    assert.match(html, /data-buy-attr="whole"/);
    assert.match(html, /Name brand kept: Dairy Pure/);
    assert.match(categoryGateHtml({ categories: [{ id: "milk", label: "Milk" }], declined: ["milk"] }), /data-gate="milk"/);
  });

  it("separates chicken cuts from real brands and skips a thin steak brand list", () => {
    const chicken = [
      product("breast", "Chicken Breast", "Breast", { departmentId: "meat-seafood", subcategory: "Chicken" }),
      product("perdue", "Boneless Chicken Breast", "Perdue", { departmentId: "meat-seafood", subcategory: "Chicken", imageUrl: "https://img.example/perdue.jpg" }),
      product("tyson", "Chicken Thighs", "Tyson", { departmentId: "meat-seafood", subcategory: "Chicken" }),
      product("pilgrim", "Chicken Wings", "Pilgrim's", { departmentId: "meat-seafood", subcategory: "Chicken" }),
      product("springer", "Chicken Breast", "Springer Mountain", { departmentId: "meat-seafood", subcategory: "Chicken" }),
      product("gv", "Chicken Breast", "Great Value", { departmentId: "meat-seafood", subcategory: "Chicken", storeBrand: true }),
    ];
    const brands = nameBrandsFor(chicken, "chicken").map((row) => row.brand);
    assert.equal(brands.includes("Breast"), false);
    assert.equal(brands.includes("Great Value"), false);
    assert.ok(brands.includes("Perdue"));
    assert.ok(brands.includes("Tyson"));
    assert.ok(brands.includes("Pilgrim's"));
    assert.ok(brands.includes("Springer Mountain"));
    assert.equal(asksNameBrand(chicken, "chicken"), true);
    const steak = [product("nb", "Ribeye Steak", "National Beef", { departmentId: "meat-seafood", subcategory: "Beef" })];
    assert.deepEqual(nameBrandsFor(steak, "steak").map((row) => row.brand), ["National Beef"]);
    assert.equal(asksNameBrand(steak, "steak"), false);
    const detail = categoryDetailHtml({
      category: { id: "steak", label: "Steak" },
      index: 10,
      total: 29,
      mode: "storeBrand",
      brand: "",
      attributes: ["ribeye"],
      attributeChoices: [{ id: "ribeye", label: "Ribeye" }],
      brands: [],
      askBrand: false,
      produce: false,
    });
    assert.doesNotMatch(detail, /data-buy="brand"/);
    assert.match(detail, /Not enough name brands/);
    assert.match(detail, /Chosen: Store brand/);
  });

  it("merges cereal sub-brands, drops junk, and cleans peanut butter and dish soap", () => {
    const cereal = [
      product("cc", "Count Chocula Cereal", "Count Chocula", { subcategory: "Cereal" }),
      product("boo", "Boo Berry Cereal", "Boo Berry®", { subcategory: "Cereal" }),
      product("gm", "Cheerios Cereal", "General Mills", { subcategory: "Cereal" }),
      product("elf", "The Elf on the Shelf Cereal", "Elf On The Shelf", { subcategory: "Cereal" }),
      product("elf2", "Elf on the Shelf", "The Elf on the Shelf", { subcategory: "Cereal" }),
    ];
    const names = nameBrandsFor(cereal, "cereal").map((row) => row.brand);
    assert.deepEqual(names, ["General Mills"]);
    assert.equal(productMatchesFamily(cereal[3], "cereal"), false);
    const peanut = [
      product("jif", "Creamy Peanut Butter", "JIF", { departmentId: "pantry", subcategory: "Condiments", imageUrl: "https://img.example/jif.jpg" }),
      product("skippy", "Creamy Peanut Butter", "Skippy", { departmentId: "pantry", subcategory: "Condiments" }),
      product("peter", "Peanut Butter", "Peter Pan", { departmentId: "pantry", subcategory: "Condiments" }),
      product("smuck", "Natural Peanut Butter", "Smucker's Natural", { departmentId: "pantry", subcategory: "Condiments" }),
      product("justin", "Peanut Butter", "Justin's", { departmentId: "pantry", subcategory: "Condiments" }),
    ];
    const shown = nameBrandsFor(peanut, "peanut-butter");
    assert.deepEqual(
      shown.map((row) => row.brand).sort(),
      ["Jif", "Justin's", "Peter Pan", "Skippy", "Smucker's Natural"]
    );
    assert.equal(shown.find((row) => row.brand === "Jif")?.imageUrl, "https://img.example/jif.jpg");
    const soap = [
      product("meyer", "Ultra Dish Soap", "MRS MEYERS CLEAN DAY", {
        departmentId: "household",
        subcategory: "Cleaning",
        imageUrl: "https://img.example/meyer.jpg",
      }),
      product("dawn", "Ultra Dish Soap", "Dawn", { departmentId: "household", subcategory: "Cleaning" }),
      product("palm", "Dish Soap", "Palmolive", { departmentId: "household", subcategory: "Cleaning" }),
    ];
    const soapNames = nameBrandsFor(soap, "dish-soap").map((row) => row.brand);
    assert.ok(soapNames.includes("Mrs. Meyer's"));
    assert.equal(soapNames.some((name) => name.length > 20), false);
    const yogurt = [
      product("c1", "Greek Yogurt", "Chobani®", { departmentId: "dairy-eggs", subcategory: "Yogurt" }),
      product("c2", "Greek Yogurt", "Chobani", { departmentId: "dairy-eggs", subcategory: "Yogurt" }),
      product("fage", "Greek Yogurt", "Fage", { departmentId: "dairy-eggs", subcategory: "Yogurt" }),
      product("oikos", "Greek Yogurt", "Oikos", { departmentId: "dairy-eggs", subcategory: "Yogurt" }),
    ];
    const yogurtNames = nameBrandsFor(yogurt, "yogurt").map((row) => row.brand);
    assert.equal(yogurtNames.filter((name) => name === "Chobani").length, 1);
  });

  it("does not ask for a name brand on fresh produce and ignores junk brands", () => {
    const onions = [
      product("mix", "Fresh Cut In Store Chopped Cilantro & White Onions", "Japanese Food Express Inc", {
        departmentId: "produce",
        subcategory: "Vegetables",
      }),
      product("yellow", "Yellow Onions", "442718", { departmentId: "produce", subcategory: "Vegetables" }),
      product("red", "Red Onions", "Unbranded", { departmentId: "produce", subcategory: "Vegetables" }),
      product("sweet", "Sweet Onions", "Fresh", { departmentId: "produce", subcategory: "Vegetables" }),
    ];
    assert.equal(isMixedStaple(onions[0].name), true);
    assert.equal(productMatchesFamily(onions[0], "onions"), false);
    assert.equal(productMatchesFamily(onions[0], "cilantro"), false);
    assert.equal(productMatchesFamily(onions[3], "onions"), true);
    assert.deepEqual(nameBrandsFor(onions, "onions"), []);
    assert.equal(asksNameBrand(onions, "onions"), false);
    const detail = categoryDetailHtml({
      category: { id: "onions", label: "Onions" },
      index: 19,
      total: 29,
      mode: "cheapest",
      brand: "",
      attributes: ["yellow"],
      attributeChoices: [
        { id: "yellow", label: "Yellow" },
        { id: "red", label: "Red" },
        { id: "sweet", label: "Sweet" },
        { id: "packaged", label: "Packaged" },
      ],
      brands: [],
      askBrand: false,
      produce: true,
    });
    assert.match(detail, /Yellow/);
    assert.match(detail, /Packaged/);
    assert.match(detail, /doesn't use a name brand/);
    assert.doesNotMatch(detail, /Japanese Food Express/);
    assert.doesNotMatch(detail, /442718/);
  });
});

describe("spoken lists and favorites", () => {
  it("splits a spoken monologue into families and refuses a mixed prepared product", () => {
    const items = parseNeedItems("Um I need bread, onions, cereal and some milk");
    assert.deepEqual(
      items.map((item) => item.family),
      ["bread", "onions", "cereal", "milk"]
    );
    const profile = setCategoryPreference(emptyProfile(), { family: "onions", mode: "cheapest", attributes: ["yellow"] });
    const shelf = [
      product("mix", "Fresh Cut In Store Chopped Cilantro & White Onions", "Japanese Food Express Inc", {
        departmentId: "produce",
        subcategory: "Vegetables",
        price: 5.99,
      }),
      product("yellow", "Yellow Onions", "Fresh", { departmentId: "produce", subcategory: "Vegetables", price: 1.29 }),
      product("bread", "White Sandwich Bread", "Nature's Own", { departmentId: "bakery", subcategory: "Bread", price: 3 }),
      product("cereal", "Toasted Oats Cereal", "General Mills", { subcategory: "Cereal", price: 4 }),
      product("milk", "Whole Milk", "Dairy Pure", { departmentId: "dairy-eggs", subcategory: "Milk", price: 3.18 }),
    ];
    const withPrefs = ["bread", "cereal", "milk"].reduce(
      (next, family) => setCategoryPreference(next, { family, mode: "cheapest" }),
      profile
    );
    const list = resolveNeedList({ profile: withPrefs, text: "I need bread, onions, cereal and milk", products: shelf });
    assert.equal(list.added.length, 4);
    assert.equal(list.added.some((row) => row.product?.id === "mix"), false);
    assert.equal(list.added.find((row) => row.family === "onions")?.product?.id, "yellow");
  });

  it("submits after a pause and still lets Stop cancel the watch", () => {
    const calls: string[] = [];
    let scheduled: (() => void) | null = null;
    const watch = createSilenceWatch({
      ms: 1700,
      onSilence: () => calls.push("silence"),
      schedule: (fn) => {
        scheduled = fn;
        return 1;
      },
      cancel: () => {
        scheduled = null;
      },
    });
    watch.heard();
    assert.equal(calls.length, 0);
    scheduled?.();
    assert.deepEqual(calls, ["silence"]);
    const stopped = createSilenceWatch({
      onSilence: () => calls.push("late"),
      schedule: (fn) => {
        scheduled = fn;
        return 2;
      },
      cancel: () => {
        scheduled = null;
      },
    });
    stopped.heard();
    stopped.stop();
    assert.equal(scheduled, null);
  });

  it("adds every holiday-baking slot only when the product actually matches", () => {
    const baking = ["flour", "sugar", "butter", "eggs", "chocolate-chips"].map((id) => slotById(id));
    const decoy = { id: "mix", name: "Holiday Baking Kit", brand: "Betty", price: 5.99 };
    const shelf = [
      decoy,
      { id: "flour", name: "All-Purpose Flour", brand: "Gold Medal" },
      { id: "sugar", name: "Granulated Sugar", brand: "Domino" },
      { id: "butter", name: "Salted Butter", brand: "Challenge" },
      { id: "eggs", name: "Large Eggs", brand: "Eggland's Best" },
      { id: "chips", name: "Semi-Sweet Chocolate Chips", brand: "Nestle" },
    ];
    const picked = baking.map((slot) => closestProduct(slot, { name: slot?.suggested.name, brand: slot?.suggested.brand }, shelf));
    assert.deepEqual(
      picked.map((row) => row?.id),
      ["flour", "sugar", "butter", "eggs", "chips"]
    );
    assert.equal(closestProduct(slotById("flour"), { name: "All-Purpose Flour" }, [decoy]), null);
  });

  it("picks the cheapest product among the brands the shopper selected", () => {
    const kraft = product("kraft", "Cheddar Cheese", "Kraft", { departmentId: "dairy-eggs", subcategory: "Cheese", price: 4.5 });
    const sargento = product("sargento", "Cheddar Cheese", "Sargento", { departmentId: "dairy-eggs", subcategory: "Cheese", price: 3.25 });
    const store = product("store", "Cheddar Cheese", "Kroger", { departmentId: "dairy-eggs", subcategory: "Cheese", price: 2, storeBrand: true });
    const profile = setCategoryPreference(emptyProfile(), {
      family: "cheese",
      mode: "cheapestPicks",
      brands: ["Kraft", "Sargento"],
    });
    const resolved = resolveCategoryPreference({ profile, family: "cheese", products: [kraft, sargento, store] });
    assert.equal(resolved.mode, "cheapestPicks");
    assert.equal(resolved.product.id, "sargento");
    assert.equal(profile.categoryPreferences.cheese.brands.includes("Kraft"), true);
  });

  it("keeps cheapest defaults off categories they never buy", () => {
    const skipped = setCategoryPreference(emptyProfile(), { family: "steak", mode: "never" });
    const next = applyCheapestDefaults(skipped, 5);
    assert.equal(next.categoryPreferences.steak.mode, "never");
    assert.equal(next.categoryPreferences.milk.mode, "cheapest");
    assert.equal(next.categoryPreferences.eggs.mode, "cheapest");
  });
});

describe("stores the shopper checked", () => {
  it("drops an unchecked store from the split and from fewer stops", () => {
    const names = planningStoreNames();
    assert.ok(names.includes("Kroger"));
    assert.ok(names.includes("Walmart"));
    const stores = [
      { storeName: "Aldi", items: [{ name: "Milk", storeName: "Aldi", offers: [{ storeName: "Walmart", price: 2 }] }] },
      { storeName: "Walmart", items: [{ name: "Eggs", storeName: "Walmart", offers: [] }] },
    ];
    const kept = filterTripStores(stores, ["Walmart", "Kroger"]);
    assert.deepEqual(kept.map((store) => store.storeName), ["Walmart"]);
    assert.equal(kept[0].items[0].offers.length, 0);
  });
});

describe("diets and custom notes", () => {
  it("saves the newer diets and a free-text other", () => {
    const profile = parseProfile({
      diets: ["carnivore", "paleo", "whole30", "low-carb", "gluten-free", "not-a-diet"],
      dietNotes: ["Mediterranean"],
      shopStores: ["Kroger", "Walmart"],
    });
    assert.ok(profile.diets.includes("carnivore"));
    assert.ok(profile.diets.includes("diabetic-friendly") === false);
    assert.equal(profile.diets.includes("not-a-diet"), false);
    assert.deepEqual(profile.dietNotes, ["Mediterranean"]);
    assert.deepEqual(profile.shopStores, ["Kroger", "Walmart"]);
    assert.equal(productExcluded(profile, { name: "White Sandwich Bread" }).excluded, true);
  });
});

describe("category preference still resolves a saved brand", () => {
  it("matches a parent cereal brand to the sub-brand on the shelf", () => {
    const cereal = product("cc", "Count Chocula Cereal", "Count Chocula", { subcategory: "Cereal", price: 4 });
    const resolved = resolveCategoryPreference({
      profile: setCategoryPreference(emptyProfile(), { family: "cereal", mode: "brand", brand: "General Mills" }),
      family: "cereal",
      products: [cereal],
    });
    assert.equal(resolved.product?.id, "cc");
  });
});
