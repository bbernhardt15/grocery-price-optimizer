import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapToDepartment } from "./departments";
import { categoryAllowed, groceryScopeDenial, WALMART_CATEGORY_ALLOW, WALMART_CATEGORY_DENY } from "./groceryScope";
import { isGroceryUpc } from "./normalize";

describe("grocery scope rules", () => {
  it("keeps the allow list out of the denylist", () => {
    assert.ok(WALMART_CATEGORY_DENY.length > 0);
    assert.ok(WALMART_CATEGORY_ALLOW.length > 0);
    for (const name of WALMART_CATEGORY_ALLOW) {
      assert.equal(categoryAllowed(name), true, name);
      assert.equal(groceryScopeDenial([name], name), null, name);
    }
  });

  it("denies the durable categories from the Nov 2 health check", () => {
    const denied = [
      ["Home/Appliances", "Appliances"],
      ["Home/Appliances/Dishwashers", "Dishwashers"],
      ["Home/Storage & Organization/Laundry Storage and Organization", "Laundry Storage and Organization"],
      ["Home/Services/Appliance Delivery", "Appliance Delivery"],
      ["Movies/Frozen Movies", "Frozen Movies"],
      ["Furniture", "Furniture"],
      ["Electronics", "Electronics"],
      ["Auto & Tires", "Auto & Tires"],
      ["Patio & Garden", "Patio & Garden"],
      ["Tools", "Tools"],
      ["Apparel", "Apparel"],
    ];
    for (const [path, name] of denied) {
      const reason = groceryScopeDenial([path], name);
      assert.ok(reason, name);
      assert.equal(mapToDepartment([path], name).departmentId, "other", name);
    }
  });

  it("does not treat delivery as deli or frozen movies as frozen food", () => {
    assert.equal(mapToDepartment(["Appliance Delivery"], "Appliance Delivery").departmentId, "other");
    assert.notEqual(mapToDepartment(["Deli/Sliced Meat"], "Oven Roasted Turkey").departmentId, "other");
    assert.equal(mapToDepartment(["Frozen Movies"], "Frozen Movies").departmentId, "other");
    assert.equal(mapToDepartment(["Food/Frozen Foods"], "Frozen Peas").departmentId, "frozen");
  });
});

describe("isGroceryUpc", () => {
  it("accepts a check-digit UPC and the stored 13-digit form, and rejects a bad check and an item id", () => {
    assert.equal(isGroceryUpc("049000042566"), true);
    assert.equal(isGroceryUpc("49000042566"), true);
    assert.equal(isGroceryUpc("0004900004256"), true);
    assert.equal(isGroceryUpc("016000275287"), true);
    assert.equal(isGroceryUpc("070708200500"), true);
    assert.equal(isGroceryUpc("12345"), false);
    assert.equal(isGroceryUpc(""), false);
    assert.equal(isGroceryUpc("local:walmart:1"), false);
  });
});
