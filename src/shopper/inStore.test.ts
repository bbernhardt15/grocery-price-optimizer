import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cachedTrip, doneMessage, rowChecked, shopProgress, shopSections, swapChoices } from "../../public/shopper/inStore.js";
import { saveTripSnapshot } from "../../public/shopper/tripPlan.js";

function memoryStorage(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return {
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key: string, value: string) {
      data[key] = String(value);
    },
  };
}

describe("in-store checklist", () => {
  const milk = { lineId: "m", name: "Milk", department: "Dairy & Eggs", aisle: "Milk", storeName: "Kroger", price: 3 };
  const yogurt = { lineId: "y", name: "Yogurt", department: "Dairy & Eggs", aisle: "Yogurt", storeName: "Kroger", price: 1 };
  const bread = { lineId: "b", name: "Bread", department: "Bakery", aisle: "Bread", storeName: "Kroger", price: 2 };
  const chips = { lineId: "c", name: "Chips", department: "Snacks", aisle: "Chips", storeName: "Aldi", price: 2 };
  const bananas = { lineId: "n", name: "Bananas", department: "Produce", aisle: "Fruit", storeName: "Aldi", price: 1 };

  it("groups by store, then department and aisle", () => {
    const sections = shopSections([
      { storeName: "Kroger", subtotal: 6, items: [bread, milk, yogurt] },
      { storeName: "Aldi", subtotal: 3, items: [chips, bananas] },
    ]);
    assert.deepEqual(
      sections.map((section) => section.storeName),
      ["Kroger", "Aldi"]
    );
    assert.deepEqual(
      sections[0].groups.map((group) => `${group.department}:${group.aisle}:${group.items.map((item) => item.name).join(",")}`),
      ["Dairy & Eggs:Milk:Milk", "Dairy & Eggs:Yogurt:Yogurt", "Bakery:Bread:Bread"]
    );
    assert.deepEqual(
      sections[1].groups.map((group) => group.department),
      ["Produce", "Snacks"]
    );
  });

  it("tracks checks, a done state, and a swap that already has a price", () => {
    const stores = [{ storeName: "Kroger", items: [milk, bread] }];
    const open = shopProgress(stores, {});
    assert.equal(open.left, 2);
    assert.equal(open.complete, false);
    assert.equal(doneMessage(open), null);
    assert.equal(rowChecked(milk, {}), false);

    const done = shopProgress(stores, { m: true, b: true });
    assert.equal(done.complete, true);
    assert.equal(done.left, 0);
    assert.equal(rowChecked(milk, { m: true }), true);
    assert.equal(doneMessage(done)?.title, "You're done");

    const choices = swapChoices({
      name: "Milk",
      storeName: "Kroger",
      offers: [
        { storeName: "Kroger", name: "Milk", price: 3.29 },
        { storeName: "Aldi", name: "Milk", price: 2.19 },
        { storeName: "Walmart", name: "Great Value Milk", price: 2.48, matchKind: "swap" },
      ],
    });
    assert.equal(choices.length, 2);
    assert.equal(choices[0].storeName, "Aldi");
    assert.equal(choices[0].price, 2.19);
    assert.equal(choices[1].price, 2.48);
    assert.equal(swapChoices({ name: "Milk", storeName: "Kroger", offers: [{ storeName: "Kroger", name: "Milk" }] }).length, 0);
  });

  it("reads the last plan from the device when nothing else is available", () => {
    const storage = memoryStorage();
    assert.equal(cachedTrip(storage), null);
    saveTripSnapshot(
      storage,
      { stores: [{ storeName: "Aldi", items: [bananas], subtotal: 1 }] },
      { lockedStore: null, moves: { n: "Aldi" } }
    );
    const saved = cachedTrip(storage);
    assert.equal(saved?.payload.stores[0].storeName, "Aldi");
    assert.equal(saved?.edits.moves.n, "Aldi");
    assert.equal(cachedTrip(memoryStorage({ "gg-last-trip": "{" })), null);
  });
});
