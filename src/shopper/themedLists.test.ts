import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickerTileHtml } from "../../public/shopper/themedListsUi.js";
import {
  arrangeLists,
  annotateFavoriteSwap,
  deleteList,
  duplicateThemed,
  emptyBook,
  listModel,
  mergeBooks,
  readBook,
  readParty,
  rememberEverywhere,
  resolveSlot,
  scaleQuantity,
  setFavorite,
  setOverride,
  slotById,
  themedList,
  writeBook,
  writeParty,
} from "../../public/shopper/themedLists.js";

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

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

const coke = {
  id: "coke-12",
  name: "Coca-Cola Classic 12 Pack 12 fl oz Cans",
  brand: "Coca-Cola",
  familyName: "Coca-Cola",
  familyKey: "beverages|coca cola|line:soda",
  sizeLabel: "12 pk",
};
const coke2 = {
  id: "coke-2l",
  name: "Coca-Cola 2 Liter Bottle",
  brand: "Coca-Cola",
  familyName: "Coca-Cola",
  familyKey: "beverages|coca cola|line:soda",
  sizeLabel: "2 L",
};
const pepsi = {
  id: "pepsi-2l",
  name: "Pepsi 2 L Bottle",
  brand: "Pepsi",
  familyName: "Pepsi",
  sizeLabel: "2 L",
};
const pepsiChoice = {
  catalogId: "pepsi-2l",
  familyKey: "",
  familyName: "Pepsi",
  name: "Pepsi 2 L Bottle",
  brand: "Pepsi",
  sizeLabel: "2 L",
  updatedAt: 5,
};
const cokeChoice = {
  catalogId: "coke-12",
  familyKey: coke.familyKey,
  familyName: "Coca-Cola",
  name: coke.name,
  brand: "Coca-Cola",
  sizeLabel: "12 pk",
  updatedAt: 2,
};

describe("themed list slots", () => {
  it("scales quantity by how many people", () => {
    assert.equal(scaleQuantity(4, 4), 1);
    assert.equal(scaleQuantity(4, 5), 2);
    assert.equal(scaleQuantity(4, 8), 2);
    assert.equal(scaleQuantity(6, 4), 1);
    assert.equal(scaleQuantity(6, 7), 2);
    assert.equal(scaleQuantity(4, 0), 1);
    assert.equal(scaleQuantity(4, 100), 6);
  });

  it("puts in-season lists first and keeps the rest under more lists", () => {
    const october = arrangeLists(new Date(2026, 9, 27));
    assert.deepEqual(
      october.featured.map((list) => list.id),
      ["thanksgiving", "tailgate"]
    );
    assert.equal(october.more.some((list) => list.id === "thanksgiving"), false);
    assert.equal(october.more.some((list) => list.id === "cookout"), true);
    assert.equal(october.more.some((list) => list.id === "july-4"), true);
    const march = arrangeLists(new Date(2026, 2, 15));
    assert.equal(march.featured.length, 0);
    assert.equal(march.more.length, october.featured.length + october.more.length);
    const july = arrangeLists(new Date(2026, 6, 4));
    assert.equal(july.featured.some((list) => list.id === "july-4"), true);
  });

  it("uses a favorite ahead of the suggestion, and a per-list override ahead of the favorite", () => {
    const soda = slotById("soda");
    assert.ok(soda);
    const shelf = [coke, coke2, pepsi];
    const suggested = resolveSlot({ slot: soda, people: 4, favorite: null, override: null, products: shelf });
    assert.equal(suggested.product.id, "coke-12");
    assert.equal(suggested.source, "suggested");
    assert.equal(suggested.swapped, null);
    assert.equal(suggested.quantity, 1);

    const favorite = resolveSlot({ slot: soda, people: 8, favorite: pepsiChoice, override: null, products: shelf });
    assert.equal(favorite.product.id, "pepsi-2l");
    assert.equal(favorite.source, "favorite");
    assert.equal(favorite.quantity, 2);

    const cookout = resolveSlot({ slot: soda, people: 4, favorite: pepsiChoice, override: cokeChoice, products: shelf });
    const tailgate = resolveSlot({ slot: soda, people: 4, favorite: pepsiChoice, override: null, products: shelf });
    assert.equal(cookout.product.id, "coke-12");
    assert.equal(cookout.source, "override");
    assert.equal(tailgate.product.id, "pepsi-2l");
    assert.equal(tailgate.source, "favorite");
    assert.equal(themedList("cookout")?.slots.some((slot) => slot.id === "soda"), true);
    assert.equal(themedList("tailgate")?.slots.some((slot) => slot.id === "soda"), true);
    assert.equal(themedList("game-day")?.slots.some((slot) => slot.id === "soda"), true);
  });

  it("falls back when a favorite is missing and leaves an unrelated item alone", () => {
    const soda = slotById("soda");
    assert.ok(soda);
    const gone = { ...cokeChoice, catalogId: "coke-gone", updatedAt: 9 };
    const resolved = resolveSlot({
      slot: soda,
      people: 4,
      favorite: gone,
      override: null,
      products: [coke2, { id: "bananas", name: "Bananas", brand: "Fresh", familyName: "Bananas" }],
    });
    assert.equal(resolved.product.id, "coke-2l");
    assert.equal(resolved.source, "fallback");
    assert.match(resolved.swapped.from, /Coca-Cola/);
    assert.equal(resolved.missing, false);

    const nothing = resolveSlot({
      slot: soda,
      people: 4,
      favorite: gone,
      override: null,
      products: [{ id: "bananas", name: "Bananas", brand: "Fresh", familyName: "Bananas" }],
    });
    assert.equal(nothing.product, null);
    assert.equal(nothing.missing, true);
    assert.equal(nothing.swapped, null);
  });

  it("remembers a favorite without a price and shares it across lists", () => {
    const storage = memoryStorage();
    assert.equal(readParty(storage), 4);
    writeParty(storage, 8);
    assert.equal(readParty(storage), 8);
    const saved = writeBook(storage, setFavorite(emptyBook(), "soda", { ...pepsiChoice, price: 1.99, storeName: "Kroger" }, 10));
    assert.equal(saved.favorites.soda.catalogId, "pepsi-2l");
    assert.equal("price" in saved.favorites.soda, false);
    assert.equal("storeName" in saved.favorites.soda, false);
    assert.equal(readBook(storage).favorites.soda.familyName, "Pepsi");
    storage.setItem("gg-starter-book", "{");
    assert.deepEqual(readBook(storage).lists, []);

    const again = setFavorite(emptyBook(), "soda", pepsiChoice, 4);
    const cookoutOnly = setOverride(again, "cookout", "soda", cokeChoice, 8);
    const shared = rememberEverywhere(cookoutOnly, "cookout", "soda", pepsiChoice, 9);
    assert.equal(shared.favorites.soda.catalogId, "pepsi-2l");
    assert.equal(shared.overrides.cookout.soda.cleared, true);
  });

  it("merges My lists by time and keeps a newer delete", () => {
    const at = 1_700_000_000_000;
    const copied = duplicateThemed(emptyBook(), "cookout", at);
    const mine = copied.lists[0];
    assert.equal(mine.name, "My Cookout");
    assert.deepEqual(
      mine.slots.map((row) => row.slotId),
      ["ground-beef", "burger-buns", "chips", "soda", "ketchup"]
    );
    const renamed = {
      ...copied,
      lists: [{ ...mine, name: "Sunday chili", updatedAt: at + 10 }],
    };
    const removed = deleteList(renamed, mine.id, at + 20);
    const merged = mergeBooks(renamed, removed);
    assert.equal(merged.lists.length, 0);
    const editedLater = mergeBooks(removed, { ...renamed, lists: [{ ...mine, name: "Sunday chili", updatedAt: at + 80 }] });
    assert.equal(editedLater.lists[0].name, "Sunday chili");
    assert.equal(listModel(mine.id, editedLater)?.title, "Sunday chili");
  });

  it("annotates a plan line when a favorite was swapped", () => {
    const line = annotateFavoriteSwap(
      { name: "Coca-Cola 2 Liter Bottle", storeName: "Kroger" },
      { "coke-2l": { from: "Coca-Cola, 12 pk", to: "Coca-Cola 2 Liter Bottle" } }
    );
    assert.equal(line.matchKind, "swap");
    assert.equal(line.substitutedFor, "Coca-Cola, 12 pk");
    const exact = annotateFavoriteSwap({ name: "Whole Milk", matchKind: "swap", substitutedFor: "Milk" }, {});
    assert.equal(exact.substitutedFor, "Milk");
  });

  it("does not print a price or a store on a picker tile", () => {
    const html = pickerTileHtml(
      {
        familyKey: "beverages|coca cola|line:soda",
        familyName: "Coca-Cola",
        brand: "Coca-Cola",
        storeName: "Kroger",
        price: 6.49,
        typicalPrice: 6.49,
        defaultVariantId: "coke-12",
        variants: [
          { id: "coke-12", label: "12 pk · 12 fl oz cans", price: 6.49, storeName: "Kroger" },
          { id: "coke-2l", label: "2 L", price: 2.18, storeName: "Walmart" },
        ],
      },
      "coke-12",
      escapeHtml
    );
    assert.match(html, /Coca-Cola/);
    assert.match(html, /12 pk/);
    assert.match(html, /Remember for every list/);
    assert.match(html, /Only on this list/);
    assert.equal(html.includes("Kroger"), false);
    assert.equal(html.includes("Walmart"), false);
    assert.equal(html.includes("6.49"), false);
    assert.equal(html.includes("Best"), false);
    assert.equal(html.includes("$"), false);
  });
});
