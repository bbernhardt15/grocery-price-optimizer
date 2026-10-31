import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapToDepartment } from "../catalog/departments";
import {
  familyFromQuery,
  isNonGroceryProduct,
  matchConfidence,
  productMatchesFamily,
  saneFamilyProducts,
} from "../catalog/stapleFamilies";
import { emptyProfile } from "../../public/shopper/profile.js";
import { resolveCategoryPreference, setCategoryPreference } from "../../public/shopper/categoryPreference.js";

const MACHINE =
  "208-240V High-Temp Undercounter Commercial Dishwasher/Glasswasher Built-In Booster, 30 inch";
const KATZ =
  "Katz Gluten Free Gingerbread Donuts |Gluten Free, Dairy Free, Nut Free, Soy Free, Kosher | (3 Pack, 10.5 Ounce Each)";

function row(
  id: string,
  name: string,
  brand: string,
  price: number,
  extra: { departmentId?: string; subcategory?: string; sizeLabel?: string } = {}
) {
  return {
    id,
    name,
    brand,
    price,
    typicalPrice: price,
    departmentId: extra.departmentId || "",
    subcategory: extra.subcategory || "",
    sizeLabel: extra.sizeLabel || "",
    offers: [{ storeName: "Walmart", price }],
  };
}

describe("ask box and voice stay in the grocery family", () => {
  const machine = row("machine", MACHINE, "Elite Kitchen Supply", 2572, { departmentId: "other" });
  const dawn = row("dawn", "Dawn Ultra Dish Soap", "Dawn", 3.49, {
    departmentId: "household",
    subcategory: "Cleaning",
    sizeLabel: "18 oz",
  });
  const cascade = row("cascade", "Cascade Dishwasher Detergent Pods", "Cascade", 14.99, {
    departmentId: "household",
    subcategory: "Cleaning",
    sizeLabel: "62 ct",
  });
  const washer = row("washer", "Commercial Washer", "Speed Queen", 1800, { departmentId: "other" });
  const tide = row("tide", "Tide Laundry Detergent", "Tide", 12.97, {
    departmentId: "household",
    subcategory: "Laundry",
    sizeLabel: "92 oz",
  });
  const dozen = row("dozen", "Glazed Donuts", "Entenmann's", 5.49, {
    departmentId: "bakery",
    subcategory: "Donuts",
    sizeLabel: "12 ct",
  });
  const katz = row("katz", KATZ, "Katz", 18.99, { departmentId: "bakery", subcategory: "Donuts", sizeLabel: "3 pk" });
  const kraft = row("kraft", "Kraft Macaroni & Cheese", "Kraft", 1.25, {
    departmentId: "pantry",
    subcategory: "Pasta & Rice",
    sizeLabel: "7.25 oz",
  });
  const macbook = row("mac", "MacBook Pro", "Apple", 1999, { departmentId: "other" });
  const bananas = row("bananas", "Bananas", "Fresh", 0.58, { departmentId: "produce", subcategory: "Fruit" });
  const bread = row("banana-bread", "Banana Bread", "Bakery", 4.5, { departmentId: "bakery", subcategory: "Bread" });

  it("maps dishwasher detergent to dish soap and never a commercial dishwasher", () => {
    assert.equal(familyFromQuery("dishwasher detergent"), "dish-soap");
    assert.equal(productMatchesFamily(dawn, "dish-soap"), true);
    assert.equal(productMatchesFamily(cascade, "dish-soap"), true);
    assert.equal(productMatchesFamily(machine, "dish-soap"), false);
    assert.equal(isNonGroceryProduct(machine), true);
    assert.equal(mapToDepartment([], MACHINE).departmentId, "other");
    assert.equal(mapToDepartment(["Appliances"], "Elite Kitchen Supply Commercial Dishwasher").generalMerchandise, true);
    const sane = saneFamilyProducts([machine, dawn, cascade], "dish-soap", { query: "dishwasher detergent" });
    assert.deepEqual(sane.map((product) => product.id).sort(), ["cascade", "dawn"]);
    const profile = setCategoryPreference(emptyProfile(), { family: "dish-soap", mode: "cheapest" });
    const picked = resolveCategoryPreference({ profile, query: "dishwasher detergent", products: [machine, dawn, cascade] });
    assert.equal(picked.product?.id, "dawn");
    assert.notEqual(picked.product?.id, "machine");
  });

  it("keeps donuts in the bakery family and off a pricey specialty pack", () => {
    assert.equal(familyFromQuery("donuts"), "donuts");
    assert.equal(productMatchesFamily(dozen, "donuts"), true);
    assert.equal(productMatchesFamily(katz, "donuts"), true);
    const sane = saneFamilyProducts([katz, dozen], "donuts", { query: "donuts" });
    assert.deepEqual(sane.map((product) => product.id), ["dozen"]);
    assert.equal(matchConfidence(katz, "donuts", [katz, dozen], "donuts"), "low");
    assert.equal(matchConfidence(dozen, "donuts", [dozen], "donuts"), "high");
    const profile = setCategoryPreference(emptyProfile(), { family: "donuts", mode: "cheapest" });
    const picked = resolveCategoryPreference({ profile, query: "donuts", products: [katz, dozen] });
    assert.equal(picked.product?.id, "dozen");
    const onlyKatz = resolveCategoryPreference({
      profile,
      query: "donuts",
      products: [row("pricey", KATZ, "Katz", 18.99, { departmentId: "bakery" })],
    });
    assert.equal(onlyKatz.product, null);
  });

  it("maps laundry detergent, mac and cheese, and bananas to their grocery families", () => {
    assert.equal(familyFromQuery("laundry detergent"), "laundry-detergent");
    assert.equal(productMatchesFamily(tide, "laundry-detergent"), true);
    assert.equal(productMatchesFamily(washer, "laundry-detergent"), false);
    assert.equal(isNonGroceryProduct(washer), true);
    const laundry = setCategoryPreference(emptyProfile(), { family: "laundry-detergent", mode: "cheapest" });
    assert.equal(
      resolveCategoryPreference({ profile: laundry, query: "laundry detergent", products: [washer, tide] }).product?.id,
      "tide"
    );

    assert.equal(familyFromQuery("mac and cheese"), "mac-and-cheese");
    assert.equal(productMatchesFamily(kraft, "mac-and-cheese"), true);
    assert.equal(productMatchesFamily(macbook, "mac-and-cheese"), false);
    const mac = setCategoryPreference(emptyProfile(), { family: "mac-and-cheese", mode: "brand", brand: "Kraft" });
    assert.equal(
      resolveCategoryPreference({ profile: mac, query: "mac and cheese", products: [macbook, kraft] }).product?.id,
      "kraft"
    );

    assert.equal(familyFromQuery("bananas"), "bananas");
    assert.equal(productMatchesFamily(bananas, "bananas"), true);
    assert.equal(productMatchesFamily(bread, "bananas"), false);
    const produce = setCategoryPreference(emptyProfile(), { family: "bananas", mode: "cheapest" });
    assert.equal(
      resolveCategoryPreference({ profile: produce, query: "bananas", products: [bread, bananas] }).product?.id,
      "bananas"
    );
  });
});
