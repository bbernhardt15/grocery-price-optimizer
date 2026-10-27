import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeSavedItems, parseSavedListWrite, type SavedListItem } from "./savedList";

function item(id: string, writtenAt: number, quantity = 1): SavedListItem {
  return {
    id,
    name: id,
    brand: "",
    sizeLabel: "",
    quantity,
    checked: false,
    writtenAt,
    baselineStore: "",
    watch: "inherit",
  };
}

describe("saved list merge", () => {
  it("replaces the list when the caller has the current revision", () => {
    const merged = mergeSavedItems([item("milk", 1), item("bread", 1)], [item("eggs", 2)], [], true);
    assert.deepEqual(merged.map((row) => row.id), ["eggs"]);
  });

  it("keeps both sides when the revision is behind and lets a later removal win", () => {
    const merged = mergeSavedItems(
      [item("milk", 2, 1), item("bread", 5)],
      [item("milk", 4, 3), item("eggs", 4)],
      [{ id: "bread", writtenAt: 6 }, { id: "eggs", writtenAt: 1 }],
      false
    );
    const byId = new Map(merged.map((row) => [row.id, row]));
    assert.equal(byId.get("milk")?.quantity, 3);
    assert.equal(byId.has("bread"), false);
    assert.equal(byId.has("eggs"), true);
  });

  it("keeps typed coupons when the save includes them", () => {
    const coupon = {
      id: "c-oreo",
      storeName: "Kroger",
      lineId: "0:large eggs",
      itemName: "Oreo",
      kind: "dollars",
      amount: 1,
      expiresOn: "2026-12-01",
    };
    const withCoupons = parseSavedListWrite({
      listId: "list-123456",
      items: [item("milk", 1)],
      coupons: [coupon],
    });
    assert.equal("error" in withCoupons, false);
    if ("error" in withCoupons) return;
    assert.equal(withCoupons.coupons?.[0].amount, 1);

    const omitted = parseSavedListWrite({
      listId: "list-123456",
      items: [item("milk", 1)],
    });
    assert.equal("error" in omitted, false);
    if ("error" in omitted) return;
    assert.equal(omitted.coupons, undefined);

    const invalid = parseSavedListWrite({
      listId: "list-123456",
      items: [item("milk", 1)],
      coupons: [{ id: "nope" }],
    });
    assert.equal("error" in invalid, true);
  });

  it("rejects a list without ids", () => {
    const parsed = parseSavedListWrite({ listId: "short", items: [] });
    assert.equal("error" in parsed, true);
  });
});
