import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { departmentName, mapToDepartment } from "./departments";

describe("mapToDepartment", () => {
  it("maps Walmart-style category paths onto the shared tree", () => {
    const dairy = mapToDepartment(["Food/Dairy, Eggs & Cheese/Milk"], "Great Value Whole Milk");
    assert.equal(dairy.departmentId, "dairy-eggs");
    assert.equal(dairy.departmentName, "Dairy & Eggs");
    assert.equal(dairy.subcategory, "Milk");

    const meat = mapToDepartment(["Food/Meat & Seafood/Chicken"], "Boneless Chicken Breast");
    assert.equal(meat.departmentId, "meat-seafood");
    assert.equal(meat.subcategory, "Chicken");

    const produce = mapToDepartment(["Fresh Produce/Fresh Fruits"], "Gala Apples");
    assert.equal(produce.departmentId, "produce");
    assert.equal(produce.subcategory, "Fruit");
  });

  it("maps Kroger category labels and prefers specific phrases over short ones", () => {
    assert.equal(mapToDepartment(["Dairy"], "Kroger 2% Milk").departmentId, "dairy-eggs");
    assert.equal(mapToDepartment(["Candy"], "Milk Chocolate Bar").departmentId, "snacks");
    assert.equal(mapToDepartment(["Pantry"], "Creamy Peanut Butter").departmentId, "pantry");
    assert.equal(mapToDepartment(["Frozen"], "Vanilla Ice Cream").departmentId, "frozen");
    assert.equal(mapToDepartment(["Frozen"], "Vanilla Ice Cream").subcategory, "Ice Cream");
  });

  it("infers a department from the product name when the retailer sent none", () => {
    assert.equal(mapToDepartment(undefined, "Whole Milk").departmentId, "dairy-eggs");
    assert.equal(mapToDepartment([], "Large Eggs").subcategory, "Eggs");
    assert.equal(mapToDepartment(undefined, "Paper Towels").departmentId, "household");
    assert.equal(mapToDepartment(undefined, "Dry Dog Food").departmentId, "pet");
    assert.equal(mapToDepartment(["Grocery"], "Shampoo").departmentId, "personal-care");
  });

  it("does not let the word milk pull chocolate or coconut milk into dairy", () => {
    assert.equal(mapToDepartment(undefined, "Milk Chocolate").departmentId, "snacks");
    assert.equal(mapToDepartment(undefined, "Coconut Milk").departmentId, "pantry");
  });

  it("keeps an explicit department id from the demo catalog", () => {
    const mapped = mapToDepartment(["Candy"], "Bananas", {
      departmentId: "produce",
      subcategory: "Fruit",
    });
    assert.equal(mapped.departmentId, "produce");
    assert.equal(mapped.subcategory, "Fruit");
    assert.equal(departmentName("produce"), "Produce");
    assert.equal(departmentName("nope"), "Other");
  });

  it("uses the deepest segment of a real retailer path, not the top-level Food bucket", () => {
    assert.equal(
      mapToDepartment(["Food/Breakfast Foods/Cereal"], "Great Value Corn Flakes").departmentId,
      "breakfast"
    );
    assert.equal(mapToDepartment(["Food/Frozen Foods/Frozen Meals"], "Pepperoni Pizza").departmentId, "frozen");
    assert.equal(mapToDepartment(["Food/Snacks, Cookies & Chips/Chips"], "Party Size Chips").departmentId, "snacks");
    assert.equal(mapToDepartment(["Food/Bakery & Bread/Bread"], "Sandwich Bread").departmentId, "bakery");
    assert.equal(mapToDepartment(["Home Page/Food/Deli/Sliced Meat"], "Oven Roasted Turkey").departmentId, "deli");
    assert.equal(mapToDepartment(["Food"], "Cheerios").departmentId, "breakfast");
    assert.equal(mapToDepartment(["Food/Pantry/Canned Goods"], "Diced Tomatoes").departmentId, "pantry");
  });

  it("falls back to Other when nothing matches", () => {
    assert.equal(mapToDepartment(["Miscellaneous"], "Widget").departmentId, "other");
  });
});
