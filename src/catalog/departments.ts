/**
 * Shared grocery department tree.
 *
 * Retailer taxonomies are not the same shape. Walmart Affiliate exposes a
 * category tree; Kroger Products is search-by-term and only returns a
 * `categories` array. Both are mapped here. Stores with no catalog source
 * never get a fake full aisle — see `coverage.ts`.
 */

export type Department = {
  id: string;
  name: string;
  subcategories: readonly string[];
};

export const DEPARTMENTS: readonly Department[] = [
  { id: "produce", name: "Produce", subcategories: ["Fruit", "Vegetables", "Fresh Herbs"] },
  { id: "dairy-eggs", name: "Dairy & Eggs", subcategories: ["Milk", "Eggs", "Cheese", "Yogurt", "Butter"] },
  { id: "meat-seafood", name: "Meat & Seafood", subcategories: ["Chicken", "Beef", "Pork", "Seafood"] },
  { id: "bakery", name: "Bakery", subcategories: ["Bread", "Rolls & Bagels", "Tortillas"] },
  { id: "deli", name: "Deli", subcategories: ["Sliced Meat", "Prepared"] },
  { id: "pantry", name: "Pantry", subcategories: ["Pasta & Rice", "Canned", "Condiments", "Baking"] },
  { id: "frozen", name: "Frozen", subcategories: ["Meals", "Vegetables", "Ice Cream"] },
  { id: "snacks", name: "Snacks", subcategories: ["Chips", "Crackers", "Candy"] },
  { id: "beverages", name: "Beverages", subcategories: ["Juice", "Soda", "Water", "Coffee & Tea"] },
  { id: "breakfast", name: "Breakfast", subcategories: ["Cereal", "Oatmeal"] },
  { id: "baby", name: "Baby", subcategories: ["Diapers", "Baby Food"] },
  { id: "household", name: "Household", subcategories: ["Paper", "Cleaning", "Laundry"] },
  { id: "personal-care", name: "Personal Care", subcategories: ["Hair", "Body", "Oral Care"] },
  { id: "pet", name: "Pet", subcategories: ["Dog", "Cat"] },
  { id: "other", name: "Other", subcategories: [] },
] as const;

const BY_ID = new Map(DEPARTMENTS.map((department) => [department.id, department]));

export function departmentById(id: string | undefined): Department | undefined {
  if (!id) {
    return undefined;
  }
  return BY_ID.get(id.trim().toLowerCase());
}

export function departmentName(id: string | undefined): string {
  return departmentById(id)?.name ?? "Other";
}

type Rule = {
  test: RegExp;
  departmentId: string;
  subcategory?: string;
};

/**
 * First match wins. Longer, more specific phrases come before short ones
 * ("peanut butter" before "butter", "ice cream" before "cream").
 */
const RULES: readonly Rule[] = [
  { test: /diaper|baby wipe|infant formula|baby food/i, departmentId: "baby", subcategory: "Diapers" },
  { test: /formula/i, departmentId: "baby", subcategory: "Baby Food" },
  { test: /dog food|dog treat|puppy/i, departmentId: "pet", subcategory: "Dog" },
  { test: /cat food|cat litter|kitten/i, departmentId: "pet", subcategory: "Cat" },
  { test: /pet food|pet supply/i, departmentId: "pet" },
  { test: /paper towel|toilet paper|bath tissue/i, departmentId: "household", subcategory: "Paper" },
  { test: /dish soap|dishwasher|all-purpose cleaner|trash bag/i, departmentId: "household", subcategory: "Cleaning" },
  { test: /laundry|detergent|fabric softener/i, departmentId: "household", subcategory: "Laundry" },
  { test: /household|cleaning supply|paper & plastic/i, departmentId: "household" },
  { test: /shampoo|conditioner/i, departmentId: "personal-care", subcategory: "Hair" },
  { test: /toothpaste|toothbrush|mouthwash/i, departmentId: "personal-care", subcategory: "Oral Care" },
  { test: /deodorant|body wash|lotion|personal care|beauty|hair care/i, departmentId: "personal-care", subcategory: "Body" },
  { test: /ice cream|frozen dessert|gelato/i, departmentId: "frozen", subcategory: "Ice Cream" },
  { test: /frozen (?:vegetable|pea|corn|meal|pizza|dinner)/i, departmentId: "frozen", subcategory: "Vegetables" },
  { test: /\bfrozen\b/i, departmentId: "frozen" },
  { test: /chocolate|candy|gummy/i, departmentId: "snacks", subcategory: "Candy" },
  { test: /peanut butter|almond butter/i, departmentId: "pantry", subcategory: "Condiments" },
  { test: /coconut milk/i, departmentId: "pantry", subcategory: "Canned" },
  { test: /pasta|spaghetti|noodle|macaroni/i, departmentId: "pantry", subcategory: "Pasta & Rice" },
  { test: /\brice\b/i, departmentId: "pantry", subcategory: "Pasta & Rice" },
  { test: /canned|tomato sauce|pasta sauce|marinara/i, departmentId: "pantry", subcategory: "Canned" },
  { test: /flour|sugar|baking/i, departmentId: "pantry", subcategory: "Baking" },
  { test: /\bbreakfast\b/i, departmentId: "breakfast" },
  { test: /cereal|cheerios|oatmeal|oat meal|granola/i, departmentId: "breakfast", subcategory: "Cereal" },
  { test: /coffee|tea bag|green tea|black tea/i, departmentId: "beverages", subcategory: "Coffee & Tea" },
  { test: /orange juice|apple juice|\bjuice\b/i, departmentId: "beverages", subcategory: "Juice" },
  { test: /soda|cola|sparkling water|\bwater\b/i, departmentId: "beverages", subcategory: "Soda" },
  { test: /beverage|drink/i, departmentId: "beverages" },
  { test: /potato chip|tortilla chip|\bchips\b|pretzel/i, departmentId: "snacks", subcategory: "Chips" },
  { test: /cracker|cookie/i, departmentId: "snacks", subcategory: "Crackers" },
  { test: /\bsnack/i, departmentId: "snacks" },
  { test: /bagel|muffin|croissant/i, departmentId: "bakery", subcategory: "Rolls & Bagels" },
  { test: /tortilla/i, departmentId: "bakery", subcategory: "Tortillas" },
  { test: /bread|bakery|bun\b/i, departmentId: "bakery", subcategory: "Bread" },
  { test: /deli|sliced turkey|sliced ham|sliced meat|lunch ?meat/i, departmentId: "deli", subcategory: "Sliced Meat" },
  { test: /salmon|shrimp|seafood|fish fillet/i, departmentId: "meat-seafood", subcategory: "Seafood" },
  { test: /chicken|poultry/i, departmentId: "meat-seafood", subcategory: "Chicken" },
  { test: /ground beef|\bbeef\b|steak/i, departmentId: "meat-seafood", subcategory: "Beef" },
  { test: /pork|bacon|sausage/i, departmentId: "meat-seafood", subcategory: "Pork" },
  { test: /\bmeat\b/i, departmentId: "meat-seafood" },
  { test: /\beggs?\b/i, departmentId: "dairy-eggs", subcategory: "Eggs" },
  { test: /cheese/i, departmentId: "dairy-eggs", subcategory: "Cheese" },
  { test: /yogurt/i, departmentId: "dairy-eggs", subcategory: "Yogurt" },
  { test: /butter|margarine/i, departmentId: "dairy-eggs", subcategory: "Butter" },
  { test: /milk|cream|dairy/i, departmentId: "dairy-eggs", subcategory: "Milk" },
  { test: /banana|apple|berry|fruit|avocado|grape/i, departmentId: "produce", subcategory: "Fruit" },
  { test: /spinach|lettuce|vegetable|broccoli|herb|onion|potato/i, departmentId: "produce", subcategory: "Vegetables" },
  { test: /produce/i, departmentId: "produce" },
  { test: /pantry|condiment|sauce|soup/i, departmentId: "pantry" },
];

const SUBCATEGORY_RULES: Record<string, readonly { test: RegExp; subcategory: string }[]> = {
  baby: [
    { test: /diaper|wipe/i, subcategory: "Diapers" },
    { test: /food|formula/i, subcategory: "Baby Food" },
  ],
  breakfast: [
    { test: /oatmeal|oat/i, subcategory: "Oatmeal" },
    { test: /cereal|cheerios/i, subcategory: "Cereal" },
  ],
  beverages: [
    { test: /coffee|tea/i, subcategory: "Coffee & Tea" },
    { test: /juice/i, subcategory: "Juice" },
    { test: /water/i, subcategory: "Water" },
    { test: /soda|cola/i, subcategory: "Soda" },
  ],
  frozen: [
    { test: /ice cream|gelato/i, subcategory: "Ice Cream" },
    { test: /meal|pizza|dinner/i, subcategory: "Meals" },
    { test: /vegetable|pea|corn/i, subcategory: "Vegetables" },
  ],
};

export type MappedDepartment = {
  departmentId: string;
  departmentName: string;
  subcategory?: string;
};

const BROAD_CATEGORY =
  /^(dairy|grocery|food|frozen|pantry|snacks?|beverages?|household|meat|produce|bakery|deli|breakfast|baby|pets?|health|beauty|personal care|health & beauty)$/i;

/** Walmart repeats the root ("Food", "Home Page") on every node. Those segments are not a department. */
const GENERIC_SEGMENT = /^(home page|grocery|food|shop all|all|categories)$/i;

function pathSegments(categories: string[]): string[] {
  const segments: string[] = [];
  for (const entry of categories) {
    for (const part of entry.split(/\s*(?:\/|>)\s*/)) {
      const trimmed = part.trim();
      if (!trimmed || GENERIC_SEGMENT.test(trimmed)) {
        continue;
      }
      segments.push(trimmed);
    }
  }
  return segments;
}

function matchRules(text: string): Rule | undefined {
  if (!text.trim()) {
    return undefined;
  }
  return RULES.find((rule) => rule.test.test(text));
}

function subcategoryFor(departmentId: string, text: string, explicit?: string): string | undefined {
  if (explicit?.trim()) {
    return explicit.trim();
  }
  const extras = SUBCATEGORY_RULES[departmentId] ?? [];
  const hit = extras.find((rule) => rule.test.test(text));
  return hit?.subcategory;
}

/**
 * Map retailer category labels plus the product name onto one department.
 * Category text is tried first so "Food/Dairy, Eggs & Cheese" beats a vague
 * title. The product name fills in when the retailer sent no usable category
 * (typical for Kroger search hits and the demo catalog).
 */
export function mapToDepartment(
  categories: string[] | undefined,
  name: string,
  explicit?: { departmentId?: string; subcategory?: string }
): MappedDepartment {
  const forced = departmentById(explicit?.departmentId);
  if (forced && forced.id !== "other") {
    return {
      departmentId: forced.id,
      departmentName: forced.name,
      subcategory: subcategoryFor(
        forced.id,
        `${(categories ?? []).join(" ")} ${name}`,
        explicit?.subcategory
      ),
    };
  }

  const labels = (categories ?? []).map((entry) => entry.trim()).filter(Boolean);
  const categoryText = labels.join(" / ");
  const segments = pathSegments(labels);
  let fromCategory: Rule | undefined;
  let categorySource = "";
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const rule = matchRules(segments[index] ?? "");
    if (rule) {
      fromCategory = rule;
      categorySource = segments[index] ?? "";
      break;
    }
  }
  if (!fromCategory) {
    fromCategory = matchRules(categoryText);
    categorySource = categoryText;
  }
  const fromName = matchRules(name);

  let rule = fromCategory ?? fromName;
  if (
    fromCategory &&
    fromName &&
    fromName.departmentId !== fromCategory.departmentId &&
    BROAD_CATEGORY.test(categorySource.trim())
  ) {
    rule = fromName;
  }

  const departmentId = rule?.departmentId ?? "other";
  const department = departmentById(departmentId) ?? DEPARTMENTS[DEPARTMENTS.length - 1];
  const sameDepartment = fromName?.departmentId === department.id ? fromName : undefined;
  const haystack = `${categoryText} ${name}`;
  return {
    departmentId: department.id,
    departmentName: department.name,
    subcategory: subcategoryFor(
      department.id,
      haystack,
      sameDepartment?.subcategory ?? rule?.subcategory ?? explicit?.subcategory
    ),
  };
}
