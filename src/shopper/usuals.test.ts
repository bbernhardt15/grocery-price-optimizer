import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STARTER_LISTS,
  matchPick,
  picksForList,
  readUsuals,
  rememberUsuals,
  starterList,
  usualKey,
} from "../../public/shopper/usuals.js";

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

describe("usuals and starter lists", () => {
  it("remembers a trip without storing a price", () => {
    const storage = memoryStorage();
    const first = rememberUsuals(
      storage,
      [{ name: "Whole Milk", brand: "Dairy Pure", catalogId: "milk-1", quantity: 2 }],
      100
    );
    assert.equal(first.length, 1);
    assert.equal(first[0].times, 1);
    assert.equal("price" in first[0], false);
    const again = rememberUsuals(storage, [{ name: "Whole Milk", catalogId: "milk-1", quantity: 1 }], 200);
    assert.equal(again[0].times, 2);
    assert.equal(again[0].quantity, 1);
    assert.equal(again[0].lastAt, 200);
    assert.equal(usualKey({ catalogId: "milk-1", name: "Other" }), "id:milk-1");
    assert.deepEqual(readUsuals(storage).map((row) => row.name), ["Whole Milk"]);
  });

  it("orders the newest trip first and ignores a broken save", () => {
    const storage = memoryStorage();
    rememberUsuals(storage, [{ name: "Bread", brand: "Nature's Own" }], 10);
    rememberUsuals(storage, [{ name: "Eggs", brand: "Goldhen" }], 20);
    assert.deepEqual(readUsuals(storage).map((row) => row.name), ["Eggs", "Bread"]);
    storage.setItem("gg-usuals", "{");
    assert.deepEqual(readUsuals(storage), []);
  });

  it("adds a whole starter list from catalog rows and never invents a price", () => {
    assert.equal(STARTER_LISTS.length, 4);
    for (const list of STARTER_LISTS) {
      assert.ok(list.picks.length >= 3, list.id);
      for (const pick of list.picks) {
        assert.equal("price" in pick, false);
        assert.equal("itemTotal" in pick, false);
      }
    }
    const weekly = starterList("weekly");
    assert.equal(weekly?.title, "Weekly basics");
    const shelf = [
      { name: "Whole Milk 1 gal", familyName: "Whole Milk", brand: "Dairy Pure", price: 3.29, id: "m" },
      { name: "Bananas", brand: "Fresh", price: 0.49, id: "b" },
      { name: "Large Eggs", brand: "Goldhen", price: 1.89, id: "e" },
      { name: "White Sandwich Bread", brand: "Nature's Own", price: 3.19, id: "br" },
      { name: "Boneless Chicken Breast", brand: "Just Bare", price: 4.99, id: "c" },
    ];
    const matched = picksForList(weekly, shelf);
    assert.equal(matched.missing.length, 0);
    assert.deepEqual(
      matched.found.map((row) => row.id),
      ["b", "m", "e", "br", "c"]
    );
    assert.equal(matchPick({ name: "Whole Milk", brand: "Great Value" }, shelf), null);
    assert.equal(matchPick(shelf[0], shelf)?.price, 3.29);
  });
});
