import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countHealthConsumableMoves, departmentName, mapToDepartment } from "./departments";

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

  it("maps grocery leaves that were falling through, and keeps general merchandise in Other", () => {
    assert.equal(mapToDepartment(["Baby/Diapering/Training Pants"], "Parent's Choice Training Pants").departmentId, "baby");
    assert.equal(mapToDepartment(["Baby/Potty Training"], "Parent's Choice Training Pants").departmentId, "baby");
    assert.equal(mapToDepartment(["Baby/Diapering"], "Parent's Choice Training Pants").subcategory, "Diapers");
    const brush = mapToDepartment(["Baby/Diapering/Baby Wipes"], "Munchkin Bottle Brush");
    assert.equal(brush.departmentId, "other");
    assert.equal(brush.signal, "excluded");
    assert.equal(brush.generalMerchandise, true);

    assert.equal(
      mapToDepartment(["Health and Medicine/Vitamins and Supplements"], "Nature Made Vitamin D").departmentId,
      "personal-care"
    );
    assert.equal(
      mapToDepartment(["Health and Medicine/Vitamins and Supplements"], "Nature Made Vitamin D").subcategory,
      "Health"
    );
    assert.equal(mapToDepartment(["Health and Medicine/Digestive Health"], "Culturelle Probiotic").departmentId, "personal-care");
    assert.equal(mapToDepartment(["Health and Medicine/First Aid"], "Isopropyl Alcohol").departmentId, "personal-care");
    assert.equal(mapToDepartment(["Health and Medicine/Diabetic Supplies"], "True Metrix Test Strips").departmentId, "personal-care");
    assert.equal(mapToDepartment(["Health and Medicine/Pain Relievers"], "Tylenol Extra Strength").departmentId, "personal-care");
    assert.equal(mapToDepartment(["Baby/Health"], "Orajel Teething Pain Relief").departmentId, "personal-care");
    assert.equal(mapToDepartment(["Health and Medicine/Weight Loss"], "Ensure Original Nutrition Shake").departmentId, "beverages");
    assert.equal(mapToDepartment(["Health and Medicine/Weight Loss/Nutrition Powders"], "Ensure Protein Powder").departmentId, "beverages");
    assert.equal(mapToDepartment(["Health and Medicine/Weight Loss"], "Testosterone Booster").departmentId, "other");
    assert.equal(mapToDepartment(["Health and Medicine/Massage"], "Handheld Massage Gun").departmentId, "other");
    assert.equal(mapToDepartment(["Health and Medicine/Mobility"], "Drive Shower Chair").departmentId, "other");
    assert.equal(mapToDepartment(["Health and Medicine/Hot & Cold Packs"], "Equate Turtleneck").departmentId, "other");
    assert.equal(mapToDepartment(["Health and Medicine/Sleep"], "Sound Machine").departmentId, "other");
    assert.equal(mapToDepartment(["Health and Medicine/Sleep"], "Sleep Mask").departmentId, "other");
    assert.equal(mapToDepartment(["Health and Medicine/Air Quality"], "Levoit Air Purifier").departmentId, "other");

    assert.equal(mapToDepartment(["Industrial & Scientific/Janitorial"], "Swiffer Duster").departmentId, "household");
    assert.equal(
      mapToDepartment(["Industrial & Scientific/Janitorial/Cleaning Chemicals"], "Commercial Degreaser").departmentId,
      "household"
    );
    assert.equal(mapToDepartment(["Industrial & Scientific"], "Drain Strainer").departmentId, "other");
    assert.equal(mapToDepartment(["Industrial & Scientific/Foodservice/Disposables"], "Dixie Cup Lids").departmentId, "household");
    assert.equal(mapToDepartment(["Industrial & Scientific/Foodservice/Disposables"], "Dixie Cup Lids").subcategory, "Paper");

    assert.equal(mapToDepartment(["Pets/Dog Food"], "Purina Dog Chow").departmentId, "pet");
    assert.equal(mapToDepartment(["Pets/Dog Treats"], "Milk-Bone").departmentId, "pet");
    assert.equal(mapToDepartment(["Pets/Cat Litter"], "Tidy Cats").departmentId, "pet");
    assert.equal(mapToDepartment(["Pets/Dog Bedding"], "Vibrant Life Cedar Bedding").departmentId, "pet");
    assert.equal(mapToDepartment(["Pets/Dog Toys"], "Vibrant Life Wheel").departmentId, "other");
    assert.equal(mapToDepartment(["Pets/Aquarium"], "Aquarium Ornament").departmentId, "other");
    assert.equal(mapToDepartment(["Pets/Horse"], "Horse Feeder").departmentId, "other");

    const gifts = mapToDepartment(["Food/Food Gifts"], "Snack Gift Tower");
    assert.equal(gifts.departmentId, "pantry");
    assert.equal(gifts.subcategory, "Gifts");

    assert.equal(mapToDepartment(["Food/Pantry/Condiments"], "Heinz Ketchup").departmentId, "pantry");
    assert.equal(mapToDepartment(["Food/Pantry/Spices & Seasonings"], "Ground Cinnamon").departmentId, "pantry");
    assert.equal(mapToDepartment(["Food/Pantry/Baking"], "Baking Powder").departmentId, "pantry");
    assert.equal(mapToDepartment(["Food/Pantry/Canned Goods"], "Canned Corn").departmentId, "pantry");
    assert.equal(mapToDepartment(["Food/International Foods"], "Yellow Curry Sauce").departmentId, "pantry");
    assert.equal(mapToDepartment(["Food/Beverages/Coffee"], "Folgers Ground Coffee").departmentId, "beverages");
    assert.equal(mapToDepartment(["Food/Beverages/Tea"], "Lipton Black Tea").departmentId, "beverages");
    assert.equal(mapToDepartment(["Food/Candy"], "Gummy Bears").departmentId, "snacks");
    assert.equal(mapToDepartment(["Food/Beverages/Mixers"], "Fever-Tree Tonic").departmentId, "beverages");
    assert.equal(mapToDepartment(["Household Essentials/Cleaning"], "All-Purpose Cleaner").departmentId, "household");
    assert.equal(mapToDepartment(["Household Essentials/Paper Products"], "Bounty Paper Towels").departmentId, "household");

    assert.equal(mapToDepartment(["Spices"], "Cumin").departmentId, "pantry");
    assert.equal(mapToDepartment(["Coffee"], "Folgers").departmentId, "beverages");
    assert.equal(mapToDepartment(["Meat & Seafood"], "Atlantic Salmon").departmentId, "meat-seafood");
    assert.equal(mapToDepartment(["Deli"], "Sliced Turkey").departmentId, "deli");
    assert.equal(mapToDepartment(["Health"], "Multivitamin").departmentId, "personal-care");

    assert.equal(mapToDepartment(["Jewelry/Necklaces"], "Personalized Necklace").departmentId, "other");
    assert.equal(mapToDepartment(["Jewelry/Necklaces"], "Personalized Necklace").generalMerchandise, true);
    assert.equal(mapToDepartment(["Office Supplies/Paper Shredders"], "Amazon Basics Paper Shredder").departmentId, "other");
    assert.equal(mapToDepartment(["Home Improvement/Tools/Work Gloves"], "Work Gloves").departmentId, "other");
    assert.equal(mapToDepartment(["Personalized Gifts"], "Personalized Gift").departmentId, "other");
    assert.equal(mapToDepartment(["Apparel/Women"], "Turtleneck").departmentId, "other");
    assert.equal(mapToDepartment(["Electronics/TVs"], "55 inch TV").departmentId, "other");
    assert.equal(mapToDepartment(["Toys/Action Figures"], "Action Figure").departmentId, "other");
    assert.equal(mapToDepartment(["Furniture/Bookcases"], "Bookcase").departmentId, "other");
    assert.equal(
      mapToDepartment(["Video Games/SpongeBob SquarePants"], "SpongeBob SquarePants Battle for Bikini Bottom").signal,
      "excluded"
    );
  });
});

const NATURE_MADE =
  "Nature Made Super B-Complex With Vitamin C & Folic Acid Twin Pack Tablets 100 ct Vitamins 2 ct";

const LETTER_VITAMINS = ["Health and Medicine/Letter Vitamins/Vitamin B Complex"];

/**
 * Production-like Other rows. The name rule's move count is toHealth + toBody.
 * A Letter Vitamins path with a name that does not match still changes
 * department on recategorize; that row is stayed here because the reason
 * is the path, and keyword search totals count it only when the name hits.
 */
const OTHER_HEALTH_FIXTURE: {
  name: string;
  categories?: string[];
  expect: "health" | "body" | "stay";
  departmentId: string;
  subcategory?: string;
}[] = [
  { name: NATURE_MADE, categories: LETTER_VITAMINS, expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: NATURE_MADE, categories: ["Letter Vitamins"], expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: NATURE_MADE, categories: ["Vitamin B Complex"], expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: NATURE_MADE, categories: ["Health and Medicine"], expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: NATURE_MADE, categories: ["Jewelry/Necklaces"], expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: NATURE_MADE, categories: ["Books/Diet"], expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: NATURE_MADE, categories: ["Clothing/Baby"], expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: NATURE_MADE, expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Centrum Specialist Super B Complex Vitamins Heart Health Tablets, 60 Ct", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "One A Day Kids: Scooby-Doo! Gummies Children's Multivitamin/Multimineral Supplement, 50 Ct", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Nature's Bounty Fish Oil Softgels, 100 ct", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Nordic Naturals Ultimate Omega Softgels", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Garden of Life Vitamin Code Men Capsules", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "OLLY Sleep Gummies", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Vitafusion Men's Multivitamin Gummies", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Equate Digestive Care Probiotic Capsules, 28 Count", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Parent's Choice Blue Raspberry Pediatric Electrolyte Drink, 1 L", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Spring Valley Children's Probiotic Gummies, 30 count", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Gevity Vitamins Horny Goat Weed Supplement, 120 Capsules", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Nature Made Melatonin Tablets, 180ct", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Thera Tears Nutrition Omega-3 Supplement Easy Swallow Capsules, 90 Count", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Alfa Vitamins Biotin 5000 Mcg, 100 Tablets", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "McNeil Rolaids Antacid/Calcium Supplement, 30 ea", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "ArtNaturals Anti Aging Hyaluronic Acid Serum with Vitamin C and E Brightening Face Serum", categories: ["Apparel/Women"], expect: "body", departmentId: "personal-care", subcategory: "Body" },
  { name: "Amopé Radiant Skin Leg & Foot Daily Hydrating Serum, 3.5 oz", expect: "body", departmentId: "personal-care", subcategory: "Body" },
  { name: "Black & Beautiful Cocoa Butter Stick with Vitamin E, 1.1 oz", expect: "body", departmentId: "personal-care", subcategory: "Body" },
  { name: "Tetra Goldfish Vitamin C Enriched Fish Food Flakes, 2.2 oz", expect: "stay", departmentId: "other" },
  { name: "Zilla Vitamin Supplement Food Spray 8 Fluid Ounces", expect: "stay", departmentId: "other" },
  { name: "Horse Chestnut Extract Supplement Capsules", expect: "health", departmentId: "personal-care", subcategory: "Health" },
  { name: "Equate Weekly 7 Day Pill Planner, Large Pill Organizer", categories: LETTER_VITAMINS, expect: "stay", departmentId: "other" },
  { name: "Restored Livefine Automatic Pill Dispenser Electronic Medication Organizer", expect: "stay", departmentId: "other" },
  { name: "Gummy Bears", categories: ["Food/Candy"], expect: "stay", departmentId: "snacks" },
  { name: "Nordic Ware Microwave Omelet Pan Cooker", expect: "stay", departmentId: "other" },
  { name: "Holly Triangles Standard Holiday Card", expect: "stay", departmentId: "other" },
  { name: "Badia Flax Seed, 1.5 oz Bag, Gluten-Free, Non-GMO, High in Omega-3", categories: ["Food/Pantry"], expect: "stay", departmentId: "pantry" },
  { name: "Fish Oil Softgels for Dogs", expect: "stay", departmentId: "other" },
  { name: "Hartz Multivitamin for Cats", categories: ["Vitamins"], expect: "stay", departmentId: "other" },
  { name: "Wardley Probiotic Turtle Sticks 3.7oz", expect: "stay", departmentId: "other" },
  { name: "Ensure Original Nutrition Shake", categories: ["Vitamins"], expect: "stay", departmentId: "beverages" },
  { name: "Similac Infant Formula with Vitamin D", categories: ["Vitamins"], expect: "stay", departmentId: "baby" },
  { name: "Turkesterone Supplement Similar to Ecdysterone for Testosterone Support", expect: "stay", departmentId: "other" },
  { name: "Handheld Massage Gun", categories: ["Health and Medicine/Massage"], expect: "stay", departmentId: "other" },
  { name: "Parent's Choice Training Pants", categories: ["Clothing/Baby"], expect: "stay", departmentId: "other" },
  { name: "Rolaids", categories: ["Baby/Health/Toddler Medicine"], expect: "stay", departmentId: "other" },
  { name: "Probiotics: A Step-By-Step Guide To Making Your Own Probiotics (Paperback)", categories: ["Books"], expect: "stay", departmentId: "other" },
  { name: "Melatonin for Sleep: Overcome Sleep Problems and Revitalize Your Body and Your Mind", expect: "stay", departmentId: "other" },
  { name: "Equate Allergy Relief Diphenhydramine HCl 25mg Antihistamine Capsules, 24 Count", expect: "stay", departmentId: "other" },
  { name: "GoodSense Glucose Tablets, Orange, 10 Ct", expect: "stay", departmentId: "other" },
  { name: "Spring Valley Black Cohosh Menopause Complex Tablets, 60 Ct", expect: "stay", departmentId: "other" },
  { name: "Centrum Ultra Womens 60ct", expect: "stay", departmentId: "other" },
  { name: "Clear Essence Complexion Soap with Alpha Hydroxy Acid, 5 oz", expect: "stay", departmentId: "other" },
  { name: "Iams Dog Food", categories: ["Toys/Dog Toys"], expect: "stay", departmentId: "other" },
  { name: "Store Brand Item", categories: ["Health and Medicine/Vitamin B Complex"], expect: "stay", departmentId: "personal-care", subcategory: "Health" },
  { name: "Chobani Probiotic Yogurt", categories: ["Dairy"], expect: "stay", departmentId: "dairy-eggs" },
  { name: "King Oscar Sardines in Fish Oil", categories: ["Canned Goods"], expect: "stay", departmentId: "pantry" },
];

describe("health consumable names", () => {
  it("moves vitamin names to personal care even when the path says Letter Vitamins or general merchandise", () => {
    const count = countHealthConsumableMoves(
      OTHER_HEALTH_FIXTURE.map((row) => ({ name: row.name, categories: row.categories }))
    );
    const toHealth = OTHER_HEALTH_FIXTURE.filter((row) => row.expect === "health").length;
    const toBody = OTHER_HEALTH_FIXTURE.filter((row) => row.expect === "body").length;
    assert.equal(toHealth, 24);
    assert.equal(toBody, 3);
    assert.deepEqual(count, {
      examined: OTHER_HEALTH_FIXTURE.length,
      toHealth,
      toBody,
      stayed: OTHER_HEALTH_FIXTURE.length - toHealth - toBody,
    });
    for (const row of OTHER_HEALTH_FIXTURE) {
      const mapped = mapToDepartment(row.categories, row.name);
      assert.equal(mapped.departmentId, row.departmentId, row.name);
      if (row.subcategory) {
        assert.equal(mapped.subcategory, row.subcategory, row.name);
      }
      if (row.expect === "health") {
        assert.match(mapped.reason ?? "", /health-consumable/, row.name);
      }
      if (row.expect === "body") {
        assert.match(mapped.reason ?? "", /skincare-serum/, row.name);
      }
    }
  });
});

