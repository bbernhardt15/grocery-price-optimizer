/**
 * Search terms for Kroger, which has no category browse.
 * `filter.term` plus optional `filter.brand`. Expand this list to deepen a department.
 * TERMS_VERSION is stored on the checkpoint; bump it when the list changes shape
 * so a resume does not skip ahead on a stale index.
 */

export const KROGER_TERMS_VERSION = 1;

export type KrogerIngestTerm = {
  departmentId: string;
  subcategory?: string;
  term: string;
  brands?: string[];
};

export const KROGER_INGEST_TERMS: readonly KrogerIngestTerm[] = [
  { departmentId: "produce", subcategory: "Fruit", term: "bananas" },
  { departmentId: "produce", subcategory: "Fruit", term: "apples" },
  { departmentId: "produce", subcategory: "Fruit", term: "berries" },
  { departmentId: "produce", subcategory: "Vegetables", term: "lettuce" },
  { departmentId: "produce", subcategory: "Vegetables", term: "onions" },
  { departmentId: "produce", subcategory: "Vegetables", term: "potatoes" },
  { departmentId: "produce", subcategory: "Fresh Herbs", term: "cilantro" },
  { departmentId: "dairy-eggs", subcategory: "Milk", term: "milk", brands: ["Kroger", "Simple Truth"] },
  { departmentId: "dairy-eggs", subcategory: "Milk", term: "almond milk" },
  { departmentId: "dairy-eggs", subcategory: "Eggs", term: "eggs", brands: ["Kroger"] },
  { departmentId: "dairy-eggs", subcategory: "Cheese", term: "cheddar cheese" },
  { departmentId: "dairy-eggs", subcategory: "Cheese", term: "shredded cheese" },
  { departmentId: "dairy-eggs", subcategory: "Yogurt", term: "yogurt" },
  { departmentId: "dairy-eggs", subcategory: "Butter", term: "butter" },
  { departmentId: "meat-seafood", subcategory: "Chicken", term: "chicken breast" },
  { departmentId: "meat-seafood", subcategory: "Chicken", term: "ground chicken" },
  { departmentId: "meat-seafood", subcategory: "Beef", term: "ground beef" },
  { departmentId: "meat-seafood", subcategory: "Beef", term: "steak" },
  { departmentId: "meat-seafood", subcategory: "Pork", term: "pork chops" },
  { departmentId: "meat-seafood", subcategory: "Seafood", term: "salmon" },
  { departmentId: "meat-seafood", subcategory: "Seafood", term: "shrimp" },
  { departmentId: "bakery", subcategory: "Bread", term: "sandwich bread", brands: ["Kroger"] },
  { departmentId: "bakery", subcategory: "Bread", term: "wheat bread" },
  { departmentId: "bakery", subcategory: "Rolls & Bagels", term: "bagels" },
  { departmentId: "bakery", subcategory: "Tortillas", term: "tortillas" },
  { departmentId: "deli", subcategory: "Sliced Meat", term: "sliced turkey" },
  { departmentId: "deli", subcategory: "Sliced Meat", term: "sliced ham" },
  { departmentId: "deli", subcategory: "Prepared", term: "rotisserie chicken" },
  { departmentId: "pantry", subcategory: "Pasta & Rice", term: "spaghetti", brands: ["Kroger"] },
  { departmentId: "pantry", subcategory: "Pasta & Rice", term: "rice" },
  { departmentId: "pantry", subcategory: "Canned", term: "canned tomatoes" },
  { departmentId: "pantry", subcategory: "Canned", term: "canned beans" },
  { departmentId: "pantry", subcategory: "Condiments", term: "peanut butter" },
  { departmentId: "pantry", subcategory: "Condiments", term: "pasta sauce" },
  { departmentId: "pantry", subcategory: "Baking", term: "all purpose flour" },
  { departmentId: "pantry", subcategory: "Baking", term: "granulated sugar" },
  { departmentId: "frozen", subcategory: "Vegetables", term: "frozen vegetables" },
  { departmentId: "frozen", subcategory: "Meals", term: "frozen pizza" },
  { departmentId: "frozen", subcategory: "Ice Cream", term: "ice cream" },
  { departmentId: "snacks", subcategory: "Chips", term: "potato chips" },
  { departmentId: "snacks", subcategory: "Crackers", term: "crackers" },
  { departmentId: "snacks", subcategory: "Candy", term: "chocolate candy" },
  { departmentId: "beverages", subcategory: "Juice", term: "orange juice" },
  { departmentId: "beverages", subcategory: "Soda", term: "cola" },
  { departmentId: "beverages", subcategory: "Water", term: "bottled water" },
  { departmentId: "beverages", subcategory: "Coffee & Tea", term: "ground coffee" },
  { departmentId: "beverages", subcategory: "Coffee & Tea", term: "tea bags" },
  { departmentId: "breakfast", subcategory: "Cereal", term: "cereal" },
  { departmentId: "breakfast", subcategory: "Oatmeal", term: "oatmeal" },
  { departmentId: "baby", subcategory: "Diapers", term: "diapers" },
  { departmentId: "baby", subcategory: "Baby Food", term: "baby food" },
  { departmentId: "household", subcategory: "Paper", term: "paper towels" },
  { departmentId: "household", subcategory: "Paper", term: "toilet paper" },
  { departmentId: "household", subcategory: "Cleaning", term: "dish soap" },
  { departmentId: "household", subcategory: "Laundry", term: "laundry detergent" },
  { departmentId: "personal-care", subcategory: "Hair", term: "shampoo" },
  { departmentId: "personal-care", subcategory: "Body", term: "body wash" },
  { departmentId: "personal-care", subcategory: "Oral Care", term: "toothpaste" },
  { departmentId: "pet", subcategory: "Dog", term: "dog food" },
  { departmentId: "pet", subcategory: "Cat", term: "cat food" },
];

export type KrogerQuery = {
  term: KrogerIngestTerm;
  brand?: string;
  termIndex: number;
  brandIndex: number;
};

/** One unbranded query, then each configured brand, per term. */
export function krogerQueries(): KrogerQuery[] {
  const queries: KrogerQuery[] = [];
  KROGER_INGEST_TERMS.forEach((term, termIndex) => {
    queries.push({ term, termIndex, brandIndex: 0 });
    (term.brands ?? []).forEach((brand, offset) => {
      queries.push({ term, brand, termIndex, brandIndex: offset + 1 });
    });
  });
  return queries;
}

export function nextKrogerStart(
  start: number,
  limit: number,
  returned: number,
  pageIndex: number,
  maxPages: number
): number | null {
  if (returned < limit) {
    return null;
  }
  if (pageIndex + 1 >= maxPages) {
    return null;
  }
  return start + returned;
}
