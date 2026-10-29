import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyProduct,
  familyFromQuery,
  productMatchesFamily,
  reportStapleFamilies,
  selectStapleTiles,
} from "./stapleFamilies";

function row(name: string, extra: Record<string, unknown> = {}) {
  return { id: name, name, brand: String(extra.brand || ""), ...extra };
}

describe("staple families", () => {
  const bad = [
    row("Butterfinger Peanut Butter Candy Bars", { brand: "Butterfinger", departmentId: "snacks", subcategory: "Candy" }),
    row("Reese's Peanut Butter Cups", { brand: "Reese's", departmentId: "snacks", subcategory: "Candy" }),
    row("Butter Chardonnay", { brand: "Butter", departmentId: "beverages", categories: ["Wine"] }),
    row("Fancy Feast Grilled Cheese Cat Food", { brand: "Fancy Feast", departmentId: "pet", subcategory: "Cat" }),
    row("Kroger Cheddar Cheese Condensed Soup", { brand: "Kroger", departmentId: "pantry", subcategory: "Canned" }),
    row("Reveal Cat Chicken Breast", { brand: "Reveal", departmentId: "pet", subcategory: "Cat" }),
    row("Freshness Guaranteed Fried Chicken", { brand: "Freshness Guaranteed", departmentId: "deli", subcategory: "Prepared" }),
  ];
  const good = [
    row("Salted Butter", { brand: "Land O Lakes", departmentId: "dairy-eggs", subcategory: "Butter", sizeLabel: "16 oz" }),
    row("Salted Butter", { brand: "Kroger", departmentId: "dairy-eggs", subcategory: "Butter", sizeLabel: "16 oz", storeBrand: true }),
    row("2% Milk", { brand: "Dairy Pure", departmentId: "dairy-eggs", subcategory: "Milk", sizeLabel: "1 gal" }),
    row("Large Eggs", { brand: "Eggland's Best", departmentId: "dairy-eggs", subcategory: "Eggs", sizeLabel: "12 ct" }),
    row("Shredded Cheddar Cheese", { brand: "Kraft", departmentId: "dairy-eggs", subcategory: "Cheese", sizeLabel: "8 oz" }),
    row("Boneless Chicken Breast", { brand: "Just Bare", departmentId: "meat-seafood", subcategory: "Chicken", sizeLabel: "1 lb" }),
    row("Ground Beef 80/20", { brand: "All Natural", departmentId: "meat-seafood", subcategory: "Beef", sizeLabel: "1 lb" }),
  ];

  it("keeps candy, wine, pet food, soup, and fried chicken out of the food families", () => {
    for (const product of bad) {
      assert.equal(productMatchesFamily(product, "butter"), false, product.name);
      assert.equal(productMatchesFamily(product, "cheese"), false, product.name);
      assert.equal(productMatchesFamily(product, "chicken"), false, product.name);
    }
    assert.equal(productMatchesFamily(bad[1], "peanut-butter"), false);
    assert.equal(classifyProduct(bad[0]), "");
    assert.equal(classifyProduct(bad[2]), "");
  });

  it("matches the real staples", () => {
    assert.equal(productMatchesFamily(good[0], "butter"), true);
    assert.equal(productMatchesFamily(good[1], "butter"), true);
    assert.equal(productMatchesFamily(good[2], "milk"), true);
    assert.equal(productMatchesFamily(good[3], "eggs"), true);
    assert.equal(productMatchesFamily(good[4], "cheese"), true);
    assert.equal(productMatchesFamily(good[5], "chicken"), true);
    assert.equal(productMatchesFamily(good[6], "ground-beef"), true);
    assert.equal(familyFromQuery("butter"), "butter");
    assert.equal(familyFromQuery("peanut butter"), "peanut-butter");
    assert.equal(familyFromQuery("chicken breast"), "chicken");
    assert.notEqual(familyFromQuery("Butterfinger"), "butter");
  });

  it("hides a WM placeholder when a real image exists and reports mismatches", () => {
    const tiles = selectStapleTiles(
      [
        { ...good[2], id: "wm", name: "WM Whole Milk", imageUrls: ["/api/catalog/placeholder.svg?t=WM"] },
        { ...good[2], id: "real", imageUrls: ["https://images.example/milk.jpg"] },
      ],
      "milk",
      4
    );
    assert.equal(tiles.some((tile) => String(tile.name).startsWith("WM")), false);
    assert.equal(tiles[0]?.id, "real");
    const report = reportStapleFamilies([...bad, ...good], { only: "butter", limit: 20 });
    const butter = report.families[0];
    assert.ok(butter.top.some((item) => item.brand === "Land O Lakes"));
    assert.ok(butter.suspected.some((item) => /Butterfinger|Chardonnay|Reese/i.test(String(item.name))));
  });
});
