import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterProducts, paginateProducts, sizeClassOf, sortProducts } from "./browse";
import type { BrowseProduct, CatalogOffer } from "./types";

function offer(overrides: Partial<CatalogOffer> & Pick<CatalogOffer, "storeName" | "price">): CatalogOffer {
  return {
    onSale: false,
    availability: "unknown",
    priceSource: "seed",
    ...overrides,
  };
}

function product(
  overrides: Partial<BrowseProduct> & Pick<BrowseProduct, "id" | "name" | "offers">
): BrowseProduct {
  const offers = overrides.offers;
  const bestOffer = [...offers].sort((a, b) => a.price - b.price)[0];
  return {
    brand: "Brand",
    imageUrls: [],
    departmentId: "pantry",
    departmentName: "Pantry",
    storeBrand: false,
    bestOffer,
    ...overrides,
  };
}

describe("filter and sort", () => {
  const milk = product({
    id: "milk",
    name: "Whole Milk",
    brand: "Dairy Pure",
    departmentId: "dairy-eggs",
    departmentName: "Dairy & Eggs",
    subcategory: "Milk",
    sizeLabel: "1 gal",
    packageSize: { dimension: "volume", amount: 128, label: "1 gal" },
    offers: [
      offer({ storeName: "Walmart", price: 3.08, unitPrice: 3.08, onSale: true }),
      offer({ storeName: "Kroger", price: 3.49, unitPrice: 3.49 }),
    ],
  });
  const storeMilk = product({
    id: "gv",
    name: "Whole Milk",
    brand: "Great Value",
    departmentId: "dairy-eggs",
    departmentName: "Dairy & Eggs",
    storeBrand: true,
    sizeLabel: "1 gal",
    packageSize: { dimension: "volume", amount: 128, label: "1 gal" },
    offers: [offer({ storeName: "Walmart", price: 2.48, unitPrice: 2.48 })],
  });
  const chips = product({
    id: "chips",
    name: "Potato Chips",
    brand: "Clancy's",
    departmentId: "snacks",
    departmentName: "Snacks",
    storeBrand: true,
    sizeLabel: "8 oz",
    packageSize: { dimension: "weight", amount: 8, label: "8 oz" },
    offers: [offer({ storeName: "Aldi", price: 1.89, unitPrice: 3.78 })],
  });
  const halfGallon = product({
    id: "half",
    name: "Whole Milk",
    brand: "Dairy Pure",
    departmentId: "dairy-eggs",
    departmentName: "Dairy & Eggs",
    sizeLabel: "0.5 gal",
    packageSize: { dimension: "volume", amount: 64, label: "0.5 gal" },
    offers: [offer({ storeName: "Target", price: 2.29, unitPrice: 4.58 })],
  });
  const catalog = [milk, storeMilk, chips, halfGallon];

  it("filters by department, store, brand, sale, store brand, price, and size", () => {
    assert.deepEqual(
      filterProducts(catalog, { departmentId: "snacks" }).map((entry) => entry.id),
      ["chips"]
    );
    assert.deepEqual(
      filterProducts(catalog, { store: "Aldi" }).map((entry) => entry.id),
      ["chips"]
    );
    assert.deepEqual(
      filterProducts(catalog, { brand: "Great Value" }).map((entry) => entry.id),
      ["gv"]
    );
    assert.deepEqual(
      filterProducts(catalog, { onSale: true }).map((entry) => entry.id),
      ["milk"]
    );
    assert.deepEqual(
      filterProducts(catalog, { storeBrand: true }).map((entry) => entry.id).sort(),
      ["chips", "gv"]
    );
    assert.deepEqual(
      filterProducts(catalog, { minPrice: 3, maxPrice: 3.2 }).map((entry) => entry.id),
      ["milk"]
    );
    assert.equal(sizeClassOf(chips), "standard");
    assert.equal(sizeClassOf(milk), "bulk");
    assert.deepEqual(
      filterProducts(catalog, { sizeClass: "bulk", departmentId: "dairy-eggs" }).map((entry) => entry.id).sort(),
      ["gv", "half", "milk"]
    );
  });

  it("sorts by price, unit price, name, and on sale first", () => {
    assert.deepEqual(
      sortProducts(catalog, "price").map((entry) => entry.id),
      ["chips", "half", "gv", "milk"]
    );
    assert.deepEqual(
      sortProducts(
        filterProducts(catalog, { departmentId: "dairy-eggs" }),
        "unitPrice"
      ).map((entry) => entry.id),
      ["gv", "milk", "half"]
    );
    assert.deepEqual(
      sortProducts([chips, milk], "name").map((entry) => entry.name),
      ["Potato Chips", "Whole Milk"]
    );
    assert.equal(sortProducts(catalog, "onSale")[0]?.id, "milk");
  });

  it("ranks a query match ahead of a cheaper unrelated product", () => {
    const ranked = sortProducts(filterProducts(catalog, { query: "potato" }), "relevance", {
      query: "potato",
    });
    assert.deepEqual(
      ranked.map((entry) => entry.id),
      ["chips"]
    );
    const milkFirst = sortProducts(filterProducts(catalog, { query: "milk" }), "relevance", {
      query: "milk",
    });
    assert.ok(milkFirst.every((entry) => /milk/i.test(entry.name)));
    assert.equal(milkFirst[0]?.id, "half");
  });

  it("paginates with an offset cursor", () => {
    const page = paginateProducts([1, 2, 3, 4, 5], 2, 2);
    assert.deepEqual(page.items, [3, 4]);
    assert.equal(page.total, 5);
    assert.equal(page.nextCursor, "4");
    assert.equal(paginateProducts([1], 0, 24).nextCursor, null);
  });
});
