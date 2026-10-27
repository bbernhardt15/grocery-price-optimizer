import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSavedListWrite } from "./savedList";
import { mergeStarterBooks, parseStarterBook } from "./starterBook";

const pepsi = {
  catalogId: "pepsi-2l",
  familyKey: "beverages|pepsi|line:soda",
  familyName: "Pepsi",
  name: "Pepsi 2 L Bottle",
  brand: "Pepsi",
  sizeLabel: "2 L",
  updatedAt: 5,
  price: 1.88,
  storeName: "Kroger",
};

describe("starter book sync", () => {
  it("drops prices and keeps a later favorite", () => {
    const parsed = parseStarterBook({
      version: 1,
      favorites: { soda: pepsi },
      overrides: {},
      lists: [],
      removed: [],
      nudged: false,
    });
    assert.equal(parsed && "error" in parsed, false);
    if (!parsed || "error" in parsed) return;
    assert.equal(parsed.favorites.soda.catalogId, "pepsi-2l");
    assert.equal(parsed.favorites.soda.familyKey, "beverages|pepsi|line:soda");
    assert.equal("price" in parsed.favorites.soda, false);
    assert.equal("storeName" in parsed.favorites.soda, false);

    const older = parseStarterBook({
      favorites: { soda: { ...pepsi, catalogId: "coke-12", name: "Coca-Cola", familyName: "Coca-Cola", updatedAt: 1 } },
    });
    const merged = mergeStarterBooks(older, parsed);
    assert.equal(merged.favorites.soda.catalogId, "pepsi-2l");
    const otherWay = mergeStarterBooks(parsed, older);
    assert.equal(otherWay.favorites.soda.catalogId, "pepsi-2l");
  });

  it("keeps a per-list override and a newer delete", () => {
    const base = {
      favorites: { soda: { ...pepsi, updatedAt: 2 } },
      overrides: { cookout: { soda: { ...pepsi, catalogId: "coke-12", name: "Coca-Cola", familyName: "Coca-Cola", updatedAt: 4 } } },
      lists: [{ id: "ml-sunday1", name: "Sunday chili", updatedAt: 10, order: 1, slots: [{ slotId: "ground-beef" }] }],
      removed: [],
    };
    const incoming = {
      favorites: { soda: { ...pepsi, updatedAt: 2 } },
      overrides: { cookout: { soda: { cleared: true, updatedAt: 3 } } },
      lists: [],
      removed: [{ id: "ml-sunday1", writtenAt: 12 }],
    };
    const merged = mergeStarterBooks(base, incoming);
    assert.equal(merged.overrides.cookout.soda && "catalogId" in merged.overrides.cookout.soda && merged.overrides.cookout.soda.catalogId, "coke-12");
    assert.equal(merged.lists.length, 0);

    const revived = mergeStarterBooks(merged, {
      lists: [{ id: "ml-sunday1", name: "Sunday chili", updatedAt: 20, order: 1, slots: [{ slotId: "chips" }] }],
    });
    assert.equal(revived.lists[0]?.slots[0]?.slotId, "chips");
  });

  it("rides along on the saved list and stays absent when omitted", () => {
    const withBook = parseSavedListWrite({
      listId: "list-123456",
      items: [],
      starterBook: { favorites: { soda: pepsi }, nudged: true },
    });
    assert.equal("error" in withBook, false);
    if ("error" in withBook) return;
    assert.equal(withBook.starterBook?.favorites.soda.brand, "Pepsi");
    assert.equal(withBook.starterBook?.nudged, true);

    const omitted = parseSavedListWrite({ listId: "list-123456", items: [] });
    assert.equal("error" in omitted, false);
    if ("error" in omitted) return;
    assert.equal(omitted.starterBook, undefined);

    const huge = parseSavedListWrite({
      listId: "list-123456",
      items: [],
      starterBook: { note: "x".repeat(100_001) },
    });
    assert.equal("error" in huge, true);
  });
});
