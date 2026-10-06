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

  it("maps Kroger aisle labels and keeps pantry for shelf-stable staples", () => {
    const labels: Array<[string, string]> = [
      ["Snacks", "snacks"],
      ["Frozen", "frozen"],
      ["Beverages", "beverages"],
      ["Breakfast", "breakfast"],
      ["Bakery", "bakery"],
      ["Canned & Packaged", "pantry"],
      ["Condiments & Sauces", "pantry"],
      ["Baking Goods", "pantry"],
      ["Pasta, Sauces, Grain", "pantry"],
      ["International", "pantry"],
      ["Adult Beverage", "beverages"],
      ["Health & Beauty", "personal-care"],
      ["Cleaning Products", "household"],
      ["Pet Care", "pet"],
      ["Baby", "other"],
    ];
    for (const [label, departmentId] of labels) {
      assert.equal(mapToDepartment([label], "Store Brand Item").departmentId, departmentId, label);
    }
    assert.equal(mapToDepartment(["Canned & Packaged"], "Chicken Breast").departmentId, "pantry");
    assert.equal(mapToDepartment(["Pet Care"], "Chicken Recipe").departmentId, "pet");
    assert.equal(mapToDepartment(["Condiments & Sauces"], "Ketchup").subcategory, "Condiments");
    assert.equal(mapToDepartment(["Baking Goods"], "All Purpose Flour").subcategory, "Baking");
  });

  it("does not let a trailing Pantry bucket beat a more specific aisle", () => {
    assert.equal(
      mapToDepartment(["Food/Breakfast Foods/Cereal", "Food/Pantry"], "Toasted Flakes").departmentId,
      "breakfast"
    );
    assert.equal(mapToDepartment(["Snacks", "Pantry"], "Party Mix").departmentId, "snacks");
    assert.equal(mapToDepartment(["Pet Care", "Pantry"], "Savory Recipe").departmentId, "pet");
    assert.equal(mapToDepartment(["Pantry"], "Creamy Peanut Butter").departmentId, "pantry");
    assert.equal(mapToDepartment(["Pantry"], "Purina ONE").signal, "broad");
    assert.equal(mapToDepartment(["Pantry"], "Dry Dog Food").departmentId, "pet");
  });

  it("does not file produce, meat, or cleaner names under baby", () => {
    assert.equal(mapToDepartment(["Baby"], "Baby Carrots").departmentId, "produce");
    assert.equal(mapToDepartment(["Baby"], "Baby Spinach").departmentId, "produce");
    assert.equal(mapToDepartment(["Baby"], "Baby Bella Mushrooms").departmentId, "produce");
    assert.equal(mapToDepartment(["Baby"], "Baby Back Ribs").departmentId, "meat-seafood");
    assert.equal(mapToDepartment(["Baby"], "Baby Back Ribs").subcategory, "Pork");
    assert.equal(mapToDepartment(undefined, "Formula 409").departmentId, "other");
    assert.equal(mapToDepartment(["Cleaning Products"], "Formula 409").departmentId, "household");
    assert.equal(mapToDepartment(["Baby"], "Pampers Swaddlers").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Diapering/Diapers"], "Pampers Swaddlers").departmentId, "baby");
    assert.equal(mapToDepartment(["Baby/Baby Food/Purees"], "Gerber Peas").departmentId, "baby");
    assert.equal(mapToDepartment(["Baby/Formula"], "Similac Infant Formula").departmentId, "baby");
    assert.equal(mapToDepartment(["Baby/Formula"], "Enfamil Formula").departmentId, "baby");
    assert.equal(mapToDepartment(["Baby/Formula"], "Similac Bottles").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Baby Food"], "Happy Baby food pouch").departmentId, "baby");
    assert.equal(mapToDepartment(["Baby/Diapering"], "Overnight Diapers").departmentId, "baby");
    assert.equal(mapToDepartment(["Baby/Potty Training"], "Goodnites Sleep Shorts").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Feeding"], "Wipe Warmer").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Feeding"], "Breast Pump").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Bottle Feeding"], "Similac Bottles").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Feeding"], "Toddler Plates").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Feeding"], "Sippy Cups").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Feeding"], "Baby Food Maker").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Nursing"], "Nursing Cover").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Health/Toddler Medicine"], "Rolaids").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Shop by Baby Brand"], "Axle Gear").departmentId, "other");
    assert.equal(mapToDepartment(["Baby"], "L A Naturals Parasite Formula").departmentId, "other");
    assert.equal(mapToDepartment(["Baby/Pacifiers"], "Philips Pacifier").signal, "excluded");
    assert.match(mapToDepartment(["Baby"], "Baby Carrots").reason ?? "", /produce/);
    const stroller = mapToDepartment(["Baby/Strollers/Full-Size"], "Graco Modes");
    assert.equal(stroller.departmentId, "other");
    assert.equal(stroller.signal, "excluded");
    assert.match(stroller.reason ?? "", /stroller/);
    assert.equal(mapToDepartment(["Baby/Clothing/Bodysuits"], "Carter's Bodysuit").signal, "excluded");
  });

  it("files cleaning, paper, and laundry in household, and keeps cookies out of pantry", () => {
    assert.equal(mapToDepartment(["Cleaning Supplies"], "Store Brand Item").departmentId, "household");
    assert.equal(mapToDepartment(["Household Essentials/Paper & Plastic/Napkins"], "Vanity Fair Napkins").departmentId, "household");
    assert.equal(mapToDepartment(["Household Essentials/Laundry/Detergent"], "Tide Pods").departmentId, "household");
    assert.equal(mapToDepartment(["Health & Beauty"], "Tide Laundry Detergent").departmentId, "household");
    assert.equal(mapToDepartment(["Health & Beauty"], "Pantene Shampoo").departmentId, "personal-care");
    assert.equal(mapToDepartment(["Pantry"], "Bounty Paper Towels").departmentId, "household");
    assert.equal(mapToDepartment(["Baby"], "Hefty Trash Bags").departmentId, "household");
    assert.equal(mapToDepartment(["Pantry"], "Clorox Disinfecting Wipes").departmentId, "household");
    assert.equal(mapToDepartment(["Pantry"], "Sugar Cookies").departmentId, "snacks");
    assert.equal(mapToDepartment(["Pantry"], "Granulated Sugar").departmentId, "pantry");
    assert.equal(mapToDepartment(undefined, "Marinara Sauce").departmentId, "pantry");
    assert.equal(mapToDepartment(undefined, "Applesauce").departmentId, "produce");
    assert.equal(mapToDepartment(["Pantry"], "Rice Krispies").departmentId, "breakfast");
    assert.equal(mapToDepartment(["Snacks"], "Walkers Shortbread").departmentId, "snacks");
    assert.equal(mapToDepartment(["Canned & Packaged"], "Chicken Breast").departmentId, "pantry");
    assert.equal(
      mapToDepartment(["Video Games/SpongeBob SquarePants"], "SpongeBob SquarePants Battle for Bikini Bottom").departmentId,
      "other"
    );
    assert.equal(
      mapToDepartment(["Household Essentials/Paper & Plastic/Toilet Paper"], "Mainstays Bathroom Storage Cabinet").departmentId,
      "other"
    );
    assert.equal(
      mapToDepartment(["Household Essentials/Paper & Plastic/Toilet Paper"], "Charmin Ultra Soft").departmentId,
      "household"
    );
    assert.equal(mapToDepartment(["Cleaning Supplies"], "Lysol Disinfecting Wipes").departmentId, "household");
    assert.equal(mapToDepartment(["Laundry"], "Tide Pods").departmentId, "household");
  });
});
