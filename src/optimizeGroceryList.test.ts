import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { optimizeGroceryList, type CatalogProduct } from "./optimizeGroceryList";

const catalog: CatalogProduct[] = [
  { name: "Whole Milk", brand: "Friendly Farms", storeName: "Aldi", price: 2.19, unit: "gal", normalizedUnit: "gal" },
  { name: "Whole Milk", brand: "Great Value", storeName: "Walmart", price: 2.48, unit: "gal", normalizedUnit: "gal" },
  { name: "White Bread", brand: "Great Value", storeName: "Walmart", price: 1.28, unit: "oz", normalizedUnit: "oz" },
  { name: "White Bread", brand: "L'oven Fresh", storeName: "Aldi", price: 1.79, unit: "oz", normalizedUnit: "oz" },
  { name: "Bananas", brand: "Fresh", storeName: "Aldi", price: 0.49, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Bananas", brand: "Fresh", storeName: "Walmart", price: 0.58, unit: "lbs", normalizedUnit: "lbs" },
  { name: "Salted Butter", brand: "Good & Gather", storeName: "Target", price: 2.79, unit: "oz", normalizedUnit: "oz" },
  { name: "Salted Butter", brand: "Friendly Farms", storeName: "Aldi", price: 3.29, unit: "oz", normalizedUnit: "oz" },
];

describe("optimizeGroceryList", () => {
  it("maps each item to the cheapest store and groups the list by storeName", () => {
    const result = optimizeGroceryList(
      ["milk", "bread", "bananas", "butter"],
      ["Aldi", "Walmart", "Target"],
      catalog
    );

    assert.deepEqual(
      result.stores.map((store) => store.storeName),
      ["Aldi", "Target", "Walmart"]
    );

    const byStore = Object.fromEntries(
      result.stores.map((store) => [store.storeName, store])
    );

    assert.equal(byStore.Aldi.items[0].query, "milk");
    assert.equal(byStore.Aldi.items[0].price, 2.19);
    assert.equal(byStore.Aldi.items[0].quantity, 1);
    assert.equal(byStore.Aldi.items[0].itemTotal, 2.19);
    assert.equal(byStore.Aldi.items[1].query, "bananas");
    assert.equal(byStore.Aldi.subtotal, 2.68);

    assert.equal(byStore.Walmart.items[0].query, "bread");
    assert.equal(byStore.Walmart.items[0].price, 1.28);

    assert.equal(byStore.Target.items[0].query, "butter");
    assert.equal(byStore.Target.items[0].price, 2.79);

    assert.equal(result.total, 6.75);
    assert.deepEqual(result.unavailable, []);
  });

  it("only considers stores in the provided list", () => {
    const result = optimizeGroceryList(["milk"], ["Walmart"], catalog);

    assert.equal(result.stores.length, 1);
    assert.equal(result.stores[0].storeName, "Walmart");
    assert.equal(result.stores[0].items[0].price, 2.48);
  });

  it("records items that no in-scope store sells", () => {
    const result = optimizeGroceryList(
      ["milk", "saffron"],
      ["Aldi"],
      catalog
    );

    assert.deepEqual(result.unavailable, ["saffron"]);
    assert.equal(result.stores[0].items.length, 1);
  });

  it("breaks equal prices by store name so the pick is stable", () => {
    const tied: CatalogProduct[] = [
      { name: "Eggs", brand: "A", storeName: "Zed Mart", price: 2, unit: "count", normalizedUnit: "count" },
      { name: "Eggs", brand: "B", storeName: "Aisle 1", price: 2, unit: "count", normalizedUnit: "count" },
    ];

    const result = optimizeGroceryList(["eggs"], [], tied);
    assert.equal(result.stores[0].storeName, "Aisle 1");
  });

  it("returns an empty grouping for an empty grocery list", () => {
    const result = optimizeGroceryList([], ["Aldi"], catalog);
    assert.deepEqual(result, { stores: [], unavailable: [], total: 0 });
  });

  it("multiplies the cheapest unit price by the requested quantity", () => {
    const result = optimizeGroceryList(
      ["2 Milk", "Bread x2"],
      ["Aldi", "Walmart"],
      catalog
    );
    const byStore = Object.fromEntries(
      result.stores.map((store) => [store.storeName, store])
    );

    assert.equal(byStore.Aldi.items[0].quantity, 2);
    assert.equal(byStore.Aldi.items[0].price, 2.19);
    assert.equal(byStore.Aldi.items[0].itemTotal, 4.38);
    assert.equal(byStore.Aldi.subtotal, 4.38);

    assert.equal(byStore.Walmart.items[0].quantity, 2);
    assert.equal(byStore.Walmart.items[0].price, 1.28);
    assert.equal(byStore.Walmart.items[0].itemTotal, 2.56);

    assert.equal(result.total, 6.94);
  });
});
