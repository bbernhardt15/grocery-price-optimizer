import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupListEntries, sectionForEntry } from "../../public/shopper/listSections.js";

describe("shopping list sections", () => {
  it("groups milk, bread, and bananas under store sections", () => {
    const groups = groupListEntries([
      { product: { name: "Kroger Vitamin D Whole Milk" } },
      { product: { name: "Dave's Killer Bread" } },
      { product: { name: "Fresh Bananas" } },
      { product: { departmentName: "Frozen", name: "Ice cream" } },
    ]);
    assert.deepEqual(
      groups.map((group) => group.section),
      ["Produce", "Bakery", "Dairy & Eggs", "Frozen"]
    );
    assert.equal(sectionForEntry({ product: { name: "Mystery gadget" } }), "Other");
  });
});
