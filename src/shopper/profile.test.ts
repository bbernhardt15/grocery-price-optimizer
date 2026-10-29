import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ONBOARDING_KEY } from "../../public/shopper/onboarding.js";
import {
  emptyProfile,
  getUserProfile,
  mergeProfiles,
  parseProfile,
  PROFILE_KEY,
  saveUserProfile,
  shouldPromptProfile,
} from "../../public/shopper/profile.js";
import {
  answerStep,
  primaryLabel,
  profileSteps,
  resumeStep,
  SKIP_LABEL,
  skipStep,
  summarySections,
} from "../../public/shopper/profileOnboarding.js";
import {
  defaultHeadcount,
  exclusionWarning,
  filterTiles,
  firstListId,
  pinnedUsualRows,
  productExcluded,
  profileToConstraints,
  shapeImportReview,
  slotIsExcluded,
} from "../../public/shopper/profileConstraints.js";
import {
  guideSlot,
  pickByBrand,
  resolveProductPreference,
  STAPLES,
} from "../../public/shopper/productPreference.js";
import { SLOTS } from "../../public/shopper/themedLists.js";

const root = path.resolve(__dirname, "../..");

function memory(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

function profileWith(patch: Record<string, unknown>) {
  return parseProfile({ ...emptyProfile(), updatedAt: 10, ...patch });
}

function product(id: string, name: string, brand: string, extra: Record<string, unknown> = {}) {
  return { id, name, brand, ...extra };
}

describe("taste profile storage", () => {
  it("migrates a partial profile and drops prices", () => {
    const parsed = parseProfile({
      loves: ["fruit", "nope"],
      productPreferences: {
        butter: { name: "Salted Butter", brand: "Challenge", locked: "yes", price: 4.29, catalogId: "butter-1" },
      },
    });
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.loves, ["fruit"]);
    assert.equal(parsed.productPreferences.butter.locked, true);
    assert.equal(parsed.productPreferences.butter.catalogId, "butter-1");
    assert.equal("price" in parsed.productPreferences.butter, false);
    assert.equal(parseProfile("nope").onboarding.status, "new");
    assert.equal(parseProfile(null).updatedAt, 0);
  });

  it("resumes after a skip and does not nag a finished older welcome", () => {
    const store = memory();
    let profile = answerStep(emptyProfile(), "household", { size: 2, kids: null, picky: null }, 20);
    profile = skipStep(profile, "allergies", 30);
    assert.equal(profile.onboarding.status, "in_progress");
    assert.equal(profile.onboarding.step, "diets");
    assert.equal(profile.household.size, 2);
    assert.deepEqual(profile.allergies, []);
    saveUserProfile(store, profile, 30);
    assert.equal(resumeStep(getUserProfile(store)), "diets");
    assert.equal(shouldPromptProfile(store), true);

    const legacy = memory({ [ONBOARDING_KEY]: "1" });
    assert.equal(shouldPromptProfile(legacy), false);
    saveUserProfile(legacy, profile, 30);
    assert.equal(shouldPromptProfile(legacy), true);
    assert.equal(profileSteps().every((step) => step.id), true);
    assert.equal(SKIP_LABEL, "Skip this one");
    assert.equal(primaryLabel("summary"), "Start shopping");
    assert.equal(summarySections(profile).some((section) => section.step === "allergies"), true);
  });

  it("keeps the newer butter lock when two devices merge", () => {
    const local = profileWith({
      updatedAt: 50,
      productPreferences: {
        butter: { family: "butter", name: "Salted Butter", brand: "Challenge", catalogId: "b1", locked: true, updatedAt: 50, source: "onboarding" },
      },
    });
    const remote = profileWith({
      updatedAt: 20,
      allergies: ["peanut"],
      productPreferences: {
        butter: { family: "butter", name: "Store Butter", brand: "Great Value", catalogId: "b2", locked: false, updatedAt: 20, source: "add" },
      },
    });
    const merged = mergeProfiles(local, remote);
    assert.equal(merged.productPreferences.butter.catalogId, "b1");
    assert.equal(merged.productPreferences.butter.locked, true);
    assert.deepEqual(merged.allergies, []);
    const otherWay = mergeProfiles(remote, { ...local, updatedAt: 80, allergies: ["soy"] });
    assert.deepEqual(otherWay.allergies, ["soy"]);
    assert.equal(otherWay.productPreferences.butter.catalogId, "b1");
  });
});

describe("hard exclusions", () => {
  const peanut = profileWith({ allergies: ["peanut"] });
  const dairyFree = profileWith({ diets: ["dairy-free"] });
  const glutenFree = profileWith({ diets: ["gluten-free"] });
  const vegetarian = profileWith({ diets: ["vegetarian"] });

  it("keeps peanut butter away from a peanut allergy and leaves plain butter", () => {
    assert.equal(productExcluded(peanut, product("pb", "Peanut Butter", "Skippy")).excluded, true);
    assert.equal(productExcluded(peanut, product("b", "Salted Butter", "Challenge")).excluded, false);
    const resolved = resolveProductPreference({
      profile: profileWith({
        allergies: ["peanut"],
        productPreferences: {
          "peanut-butter": { family: "peanut-butter", name: "Peanut Butter", brand: "Skippy", catalogId: "pb", locked: true, updatedAt: 1, source: "onboarding" },
          butter: { family: "butter", name: "Salted Butter", brand: "Challenge", catalogId: "b", locked: true, updatedAt: 1, source: "onboarding" },
        },
      }),
      query: "peanut butter",
      products: [product("pb", "Peanut Butter", "Skippy"), product("b", "Salted Butter", "Challenge")],
    });
    assert.equal(resolved.status, "excluded");
    assert.equal(resolved.product, null);
    assert.match(resolved.warning, /searched/i);
    const butter = resolveProductPreference({
      profile: peanut,
      query: "butter",
      products: [product("pb", "Peanut Butter", "Skippy"), product("b", "Salted Butter", "Challenge")],
    });
    assert.equal(butter.status, "none");
    const exact = resolveProductPreference({
      profile: profileWith({
        allergies: ["peanut"],
        productPreferences: {
          butter: { family: "butter", name: "Salted Butter", brand: "Challenge", catalogId: "b", locked: true, updatedAt: 1, source: "onboarding" },
        },
      }),
      query: "butter",
      products: [product("pb", "Peanut Butter", "Skippy"), product("b", "Salted Butter", "Challenge")],
    });
    assert.equal(exact.status, "preferred");
    assert.equal(exact.product?.id, "b");
    assert.equal(exact.change, true);
  });

  it("treats dairy-free, gluten-free, and vegetarian as harder than a saved product", () => {
    assert.equal(productExcluded(dairyFree, product("b", "Salted Butter", "Challenge")).excluded, true);
    assert.equal(productExcluded(dairyFree, product("oat", "Oat Milk", "Oatly")).excluded, false);
    assert.equal(productExcluded(dairyFree, product("pb", "Peanut Butter", "Skippy")).excluded, false);
    assert.equal(productExcluded(dairyFree, product("choc", "Milk Chocolate", "Hershey's")).excluded, true);
    const swapped = resolveProductPreference({
      profile: profileWith({
        diets: ["dairy-free"],
        productPreferences: {
          butter: { family: "butter", name: "Salted Butter", brand: "Challenge", catalogId: "b", locked: true, updatedAt: 4, source: "onboarding" },
        },
      }),
      family: "butter",
      products: [product("b", "Salted Butter", "Challenge"), product("plant", "Dairy-Free Plant Butter", "Melt")],
    });
    assert.equal(swapped.status, "swapped");
    assert.equal(swapped.product?.id, "plant");
    assert.match(swapped.swapped?.from || "", /Challenge/);
    assert.match(swapped.swapped?.to || "", /Plant Butter/);
    const onlyDairy = resolveProductPreference({
      profile: dairyFree,
      family: "butter",
      products: [product("b", "Salted Butter", "Challenge")],
    });
    assert.equal(onlyDairy.product, null);

    assert.equal(productExcluded(glutenFree, product("pasta", "Spaghetti Pasta", "Barilla")).excluded, true);
    assert.equal(productExcluded(glutenFree, product("gf", "Gluten-Free Spaghetti", "Barilla")).excluded, false);
    assert.equal(productExcluded(glutenFree, product("buck", "Buckwheat", "Bob's")).excluded, false);
    const pasta = guideSlot({
      profile: glutenFree,
      slot: SLOTS.pasta,
      products: [product("pasta", "Spaghetti Pasta", "Barilla"), product("gf", "Gluten-Free Spaghetti", "Barilla")],
      people: 4,
    });
    assert.equal(pasta.excluded, false);
    assert.equal(pasta.product?.id, "gf");

    assert.equal(productExcluded(vegetarian, product("beef", "Ground Beef 80/20", "All Natural")).excluded, true);
    assert.equal(productExcluded(vegetarian, product("pb", "Peanut Butter", "Skippy")).excluded, false);
    assert.equal(productExcluded(vegetarian, product("eggs", "Large Eggs", "Goldhen")).excluded, false);
    assert.equal(slotIsExcluded(vegetarian, SLOTS["ground-beef"]), true);
    const beef = resolveProductPreference({
      profile: profileWith({
        diets: ["vegetarian"],
        productPreferences: {
          "ground-beef": { family: "ground-beef", name: "Ground Beef 80/20", brand: "All Natural", catalogId: "beef", locked: true, updatedAt: 2, source: "add" },
        },
      }),
      query: "ground beef",
      products: [product("beef", "Ground Beef 80/20", "All Natural")],
    });
    assert.equal(beef.status, "excluded");
    assert.equal(beef.product, null);
    const guided = guideSlot({
      profile: vegetarian,
      slot: SLOTS["ground-beef"],
      products: [product("beef", "Ground Beef 80/20", "All Natural")],
      people: 4,
    });
    assert.equal(guided.excluded, true);
    assert.equal(guided.product, null);
  });

  it("warns on an explicit search and still filters the shelf", () => {
    const tiles = [product("pb", "Peanut Butter", "Skippy"), product("b", "Salted Butter", "Challenge")];
    assert.match(exclusionWarning(peanut, "peanut butter"), /searched/i);
    assert.equal(filterTiles(peanut, tiles, "peanut butter").length, 2);
    assert.deepEqual(filterTiles(peanut, tiles).map((row) => row.id), ["b"]);
  });
});

describe("brand defaults and product resolution", () => {
  const dairyPure = product("dp", "Whole Milk", "Dairy Pure", { price: 3.18 });
  const greatValue = product("gv", "Whole Milk", "Great Value", { price: 2.48, storeBrand: true });
  const organic = product("org", "Organic Whole Milk", "Organic Valley", { price: 3.3 });

  it("uses store brand, name brand, and a real cheaper price", () => {
    const store = resolveProductPreference({
      profile: profileWith({ brand: { default: "store", organicIfClose: false, overrides: {} } }),
      query: "milk",
      products: [dairyPure, greatValue],
    });
    assert.equal(store.status, "brand");
    assert.equal(store.product?.id, "gv");
    const name = resolveProductPreference({
      profile: profileWith({ brand: { default: "name", organicIfClose: false, overrides: {} } }),
      query: "milk",
      products: [dairyPure, greatValue],
    });
    assert.equal(name.product?.id, "dp");
    const cheap = resolveProductPreference({
      profile: profileWith({ brand: { default: "cheaper", organicIfClose: false, overrides: {} } }),
      query: "milk",
      products: [dairyPure, greatValue],
    });
    assert.equal(cheap.product?.id, "gv");
    const unpriced = [product("dp", "Whole Milk", "Dairy Pure"), product("gv", "Whole Milk", "Great Value", { storeBrand: true })];
    const noPrice = pickByBrand(unpriced, "cheaper", false);
    assert.equal(noPrice?.id, "dp");
    assert.equal(noPrice && "price" in noPrice, false);
  });

  it("picks organic only when the catalog price is close", () => {
    const close = pickByBrand([dairyPure, organic], "name", true);
    assert.equal(close?.id, "org");
    const far = pickByBrand([dairyPure, product("org", "Organic Whole Milk", "Organic Valley", { price: 5 })], "name", true);
    assert.equal(far?.id, "dp");
    const missing = pickByBrand([product("dp", "Whole Milk", "Dairy Pure"), product("org", "Organic Whole Milk", "Organic Valley")], "name", true);
    assert.equal(missing?.id, "dp");
  });

  it("lets a locked product beat the brand, and swaps when that product is missing", () => {
    const locked = resolveProductPreference({
      profile: profileWith({
        brand: { default: "store", organicIfClose: false, overrides: {} },
        productPreferences: {
          milk: { family: "milk", name: "Whole Milk", brand: "Dairy Pure", catalogId: "dp", locked: true, updatedAt: 3, source: "onboarding" },
        },
      }),
      query: "milk",
      products: [dairyPure, greatValue],
    });
    assert.equal(locked.status, "preferred");
    assert.equal(locked.product?.id, "dp");
    const gone = resolveProductPreference({
      profile: profileWith({
        productPreferences: {
          butter: { family: "butter", name: "Salted Butter", brand: "Challenge", catalogId: "missing", locked: true, updatedAt: 3, source: "onboarding" },
        },
      }),
      query: "butter",
      products: [product("aldi", "Salted Butter", "Countryside Creamery", { storeBrand: true })],
    });
    assert.equal(gone.status, "swapped");
    assert.equal(gone.product?.id, "aldi");
    assert.equal(gone.swapped && `We swapped ${gone.swapped.from} for ${gone.swapped.to}`, "We swapped Challenge Salted Butter for Countryside Creamery Salted Butter");
    const blocked = resolveProductPreference({
      profile: profileWith({
        brand: { default: "name", organicIfClose: false, overrides: {} },
        neverProducts: [{ family: "milk", catalogId: "dp", name: "Whole Milk", brand: "Dairy Pure", updatedAt: 1 }],
        productPreferences: {
          milk: { family: "milk", name: "Whole Milk", brand: "Dairy Pure", catalogId: "dp", locked: true, updatedAt: 3, source: "onboarding" },
        },
      }),
      query: "milk",
      products: [dairyPure, greatValue],
    });
    assert.notEqual(blocked.product?.id, "dp");
    assert.equal(blocked.product?.id, "gv");
  });

  it("seeds headcount, usuals, and a cuisine list from the profile", () => {
    const family = profileWith({ household: { size: 5, kids: true, picky: false }, always: ["oat milk"], mustHaves: ["oat milk"] });
    assert.equal(defaultHeadcount(family), 5);
    assert.equal(defaultHeadcount(emptyProfile()), null);
    assert.equal(pinnedUsualRows(family)[0].name, "oat milk");
    assert.equal(firstListId(profileWith({ cuisines: { mexican: "like" } })), "taco-night");
    const constraints = profileToConstraints(profileWith({
      allergies: ["peanut"],
      productPreferences: {
        butter: { family: "butter", name: "Salted Butter", brand: "Challenge", catalogId: "b", locked: true, updatedAt: 1, source: "onboarding" },
      },
    }));
    assert.deepEqual(constraints.allergies, ["peanut"]);
    assert.equal(constraints.preferredProducts[0].id, "b");
    assert.equal(constraints.preferredProducts[0].name, "Salted Butter");
    const shaped = shapeImportReview({ items: [{ name: "Peanut Butter", choices: [{ product: product("pb", "Peanut Butter", "Skippy") }], status: "matched" }, { name: "Bananas", choices: [{ product: product("ban", "Bananas", "Fresh") }], status: "matched" }], total: 2 }, profileWith({ allergies: ["peanut"] }));
    assert.equal(shaped.review.items.length, 1);
    assert.match(shaped.note, /Peanut Butter/);
    assert.ok(STAPLES.some((staple) => staple.id === "butter"));
  });
});

describe("profile screens", () => {
  it("ships the guide, My products, and the three modules", () => {
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
    assert.match(html, /id="profile-onboard"/);
    assert.match(html, /id="profile-skip"/);
    assert.match(html, />Skip this one</);
    assert.match(html, /id="profile-back"/);
    assert.match(html, /id="drawer-profile"/);
    assert.match(html, /id="drawer-products"/);
    assert.match(html, /id="products-dialog"/);
    assert.match(html, /id="always-prompt"/);
    assert.match(app, /getUserProfile\(/);
    assert.match(app, /profileToConstraints\(/);
    assert.match(app, /resolveProductPreference\(/);
    assert.equal(PROFILE_KEY, "gg-profile");
  });
});
