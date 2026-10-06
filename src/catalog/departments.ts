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
  { test: /^snacks?$/i, departmentId: "snacks" },
  { test: /^frozen(?:\s+foods?)?$/i, departmentId: "frozen" },
  { test: /^beverages?$/i, departmentId: "beverages" },
  { test: /^breakfast(?:\s+foods?)?$/i, departmentId: "breakfast" },
  { test: /^bakery(?:\s*&\s*bread)?$/i, departmentId: "bakery" },
  { test: /^canned\s*&\s*packaged$/i, departmentId: "pantry", subcategory: "Canned" },
  { test: /^condiments?\s*&\s*(?:sauces?|toppings)$/i, departmentId: "pantry", subcategory: "Condiments" },
  { test: /^baking goods$/i, departmentId: "pantry", subcategory: "Baking" },
  { test: /^pasta,\s*sauces?,\s*grain$/i, departmentId: "pantry", subcategory: "Pasta & Rice" },
  { test: /^international$/i, departmentId: "pantry" },
  { test: /^adult beverages?$/i, departmentId: "beverages" },
  { test: /^health\s*&\s*beauty$/i, departmentId: "personal-care" },
  { test: /^cleaning (?:products?|supplies)$/i, departmentId: "household", subcategory: "Cleaning" },
  { test: /^paper\s*(?:&|and)\s*plastic$/i, departmentId: "household", subcategory: "Paper" },
  { test: /^paper goods$/i, departmentId: "household", subcategory: "Paper" },
  { test: /^laundry$/i, departmentId: "household", subcategory: "Laundry" },
  { test: /^household essentials?$/i, departmentId: "household" },
  { test: /^pet care$/i, departmentId: "pet" },
  { test: /^baby$/i, departmentId: "baby" },
  { test: /baby back ribs?/i, departmentId: "meat-seafood", subcategory: "Pork" },
  { test: /carrot cake/i, departmentId: "bakery" },
  {
    test: /\bbaby\s+(?:carrots?|spinach|kale|bok choy|potatoes|potato|bella|portobell\w*|arugula|gem|broccoli|romaine|greens)\b/i,
    departmentId: "produce",
    subcategory: "Vegetables",
  },
  { test: /diaper|baby wipe/i, departmentId: "baby", subcategory: "Diapers" },
  { test: /infant formula|baby formula|baby food(?!\s*makers?\b)/i, departmentId: "baby", subcategory: "Baby Food" },
  { test: /dog food|dog treat|puppy/i, departmentId: "pet", subcategory: "Dog" },
  { test: /cat food|cat litter|kitten/i, departmentId: "pet", subcategory: "Cat" },
  { test: /pet food|pet supply/i, departmentId: "pet" },
  { test: /paper towel|toilet paper|bath tissue|paper napkin|paper plate|\bnapkins?\b|facial tissue|paper goods|plastic wrap|aluminum foil|sandwich bag/i, departmentId: "household", subcategory: "Paper" },
  { test: /dish soap|dish detergent|dishwasher|all-purpose cleaner|disinfect(?:ant|ing)|\bbleach\b|trash bag|garbage bag|\bsponges?\b/i, departmentId: "household", subcategory: "Cleaning" },
  { test: /laundry|detergent|fabric softener|dryer sheets?/i, departmentId: "household", subcategory: "Laundry" },
  { test: /household|cleaning supplies?|paper\s*(?:&|and)\s*plastic/i, departmentId: "household" },
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
  { test: /cereal|cheerios|krispies|\bchex\b|oatmeal|oat meal|granola/i, departmentId: "breakfast", subcategory: "Cereal" },
  { test: /\brice\b/i, departmentId: "pantry", subcategory: "Pasta & Rice" },
  { test: /canned|tomato sauce|pasta sauce|marinara/i, departmentId: "pantry", subcategory: "Canned" },
  { test: /potato chip|tortilla chip|\bchips\b|pretzel/i, departmentId: "snacks", subcategory: "Chips" },
  { test: /cracker|cookie/i, departmentId: "snacks", subcategory: "Crackers" },
  { test: /flour|sugar|baking/i, departmentId: "pantry", subcategory: "Baking" },
  { test: /\bbreakfast\b/i, departmentId: "breakfast" },
  { test: /coffee|tea bag|green tea|black tea/i, departmentId: "beverages", subcategory: "Coffee & Tea" },
  { test: /orange juice|apple juice|\bjuice\b/i, departmentId: "beverages", subcategory: "Juice" },
  { test: /soda|cola|sparkling water|\bwater\b/i, departmentId: "beverages", subcategory: "Soda" },
  { test: /beverage|drink/i, departmentId: "beverages" },
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
  { test: /\bcarrots?\b/i, departmentId: "produce", subcategory: "Vegetables" },
  { test: /spinach|lettuce|vegetable|broccoli|herb|onion|potato|bok choy|kale|arugula/i, departmentId: "produce", subcategory: "Vegetables" },
  { test: /produce/i, departmentId: "produce" },
  { test: /\bpantry\b|\bcondiments?\b|\bsauce\b|\bsoup\b/i, departmentId: "pantry" },
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
  /**
   * specific: a real aisle label (Snacks, Pet Care, Canned & Packaged).
   * broad: only a weak bucket such as Pantry, so a search term may still win.
   * name: the product name decided. none: nothing matched.
   */
  signal?: "specific" | "broad" | "name" | "none" | "excluded";
  /** Short explanation of the match, for the admin sample route. */
  reason?: string;
};

/**
 * A lone "Pantry" or "Baby" must not beat a more specific aisle, and must not
 * beat the product name. "Baby" as a whole Walmart/Kroger department also
 * covers strollers and clothes; those are excluded separately.
 */
const WEAK_SEGMENT = /^(pantry|grocery|food|natural\s*&\s*organic|baby)$/i;

const BROAD_CATEGORY =
  /^(dairy|grocery|food|frozen|pantry|snacks?|beverages?|household|meat|produce|bakery|deli|breakfast|baby|pets?|health|beauty|personal care|health & beauty)$/i;

/** Walmart repeats the root ("Food", "Home Page") on every node. Those segments are not a department. */
const GENERIC_SEGMENT = /^(home page|grocery|food|shop all|all|categories|natural\s*&\s*organic)$/i;

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

/**
 * Grocery baby is diapers, wipes, formula, and baby food. Feeding gear,
 * nursery, travel, activities, and brand-shop leaves are not.
 */
const BABY_FALSE_FRIEND =
  /^baby\s+(?:carrots?|spinach|kale|bok choy|potatoes|potato|bella|portobell\w*|arugula|gem|broccoli|romaine|greens|back ribs?)$/i;

const BABY_BLOCKED_BRANCH =
  /^(?:baby activities|activities|nursery|travel gear|resold baby|shop by baby brand|shop by brand|car seats?|strollers?|clothing|apparel|toys|feeding gear)$/i;

const BABY_EQUIPMENT =
  /\b(?:wipe warmers?|breast pumps?|nursing covers?|sippy cups?|toddler plates?|sleep shorts?|food makers?|baby food makers?|bottle feed(?:ing|ers?)?|baby bottles?|pacifiers?|teethers?|strollers?|car\s*seats?|cribs?|bassinets?|high\s*chairs?|playards?|play\s*yards?|baby\s*swings?|nursing pillows?|diaper\s*bags?|onesies|bodysuits?|baby monitors?)\b/i;

const BABY_CONSUMABLE =
  /\b(?:diapers?|diapering|baby wipes?|infant formula|baby formula|baby foods?(?!\s*makers?\b)|food pouches?)\b/i;

const NOT_GROCERY =
  /\b(?:video games?|xbox|playstation|nintendo)\b|\b(?:cabinets?|bookcases?|dressers?|nightstands?|bathroom storage)\b/i;

function inBabyDepartment(categories: string[]): boolean {
  return pathSegments(categories).some((segment) => {
    if (BABY_FALSE_FRIEND.test(segment)) {
      return false;
    }
    return /^baby$/i.test(segment) || /^baby\b/i.test(segment) || BABY_BLOCKED_BRANCH.test(segment);
  });
}

function isBabyConsumable(categories: string[], name: string): boolean {
  const segments = pathSegments(categories);
  const leaf = segments.at(-1) ?? "";
  const focus = `${leaf} ${name}`;
  const text = `${categories.join(" ")} ${name}`;
  if (BABY_EQUIPMENT.test(focus)) {
    return false;
  }
  if (/\bparasite\b|\bformula\s*409\b/i.test(text)) {
    return false;
  }
  if (/\bbottles?\b/i.test(focus) && !/\b(?:infant|baby)\s+formula\b/i.test(focus)) {
    return false;
  }
  if (BABY_CONSUMABLE.test(text)) {
    return true;
  }
  if (!inBabyDepartment(categories)) {
    return false;
  }
  if (/\bformula\b/i.test(text)) {
    return true;
  }
  return /\b(?:wipes|purees?|jars?)\b/i.test(focus);
}

function babyGearLabel(categories: string[], name: string): string | null {
  const segments = pathSegments(categories);
  const leaf = segments.at(-1) ?? "";
  const focus = `${leaf} ${name}`;
  if (isBabyConsumable(categories, name)) {
    return null;
  }
  const equipment = focus.match(BABY_EQUIPMENT);
  if (equipment && (inBabyDepartment(categories) || BABY_EQUIPMENT.test(name))) {
    return equipment[0].toLowerCase().replace(/\s+/g, " ");
  }
  if (inBabyDepartment(categories) && /\bwalkers?\b/i.test(focus)) {
    return "walker";
  }
  if (inBabyDepartment(categories) && /\bswings?\b/i.test(focus)) {
    return "swing";
  }
  if (inBabyDepartment(categories) && /\bbottles?\b/i.test(focus) && !/\b(?:infant|baby)\s+formula\b/i.test(focus)) {
    return "bottles";
  }
  if (!inBabyDepartment(categories)) {
    return null;
  }
  for (const segment of segments) {
    if (BABY_BLOCKED_BRANCH.test(segment)) {
      return segment.toLowerCase();
    }
  }
  return null;
}

function notGroceryLabel(categories: string[], name: string): string | null {
  const leaf = pathSegments(categories).at(-1) ?? "";
  const focus = `${leaf} ${name}`;
  const match = focus.match(NOT_GROCERY) ?? `${categories.join(" ")} ${name}`.match(/\b(?:video games?|xbox|playstation|nintendo)\b/i);
  if (!match) {
    return null;
  }
  const label = match[0].toLowerCase();
  if (/video game|xbox|playstation|nintendo/.test(label)) {
    return "video game";
  }
  return "furniture";
}

function reasonText(kind: "path" | "name" | "none", source: string, departmentId: string): string {
  if (kind === "none") {
    return "none";
  }
  const label = source.replace(/\s+/g, " ").trim().slice(0, 48);
  return `${kind}:${label}→${departmentId}`;
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
  const labels = (categories ?? []).map((entry) => entry.trim()).filter(Boolean);
  const other = departmentById("other") ?? DEPARTMENTS[DEPARTMENTS.length - 1];
  const junk = notGroceryLabel(labels, name);
  if (junk) {
    return {
      departmentId: other.id,
      departmentName: other.name,
      signal: "excluded",
      reason: `not-grocery:${junk}→other`,
    };
  }
  const gear = babyGearLabel(labels, name);
  if (gear) {
    return {
      departmentId: other.id,
      departmentName: other.name,
      signal: "excluded",
      reason: `gear:${gear}→other`,
    };
  }

  const forced = departmentById(explicit?.departmentId);
  if (forced && forced.id !== "other") {
    return {
      departmentId: forced.id,
      departmentName: forced.name,
      subcategory: subcategoryFor(
        forced.id,
        `${labels.join(" ")} ${name}`,
        explicit?.subcategory
      ),
      signal: "specific",
      reason: `explicit:${forced.id}`,
    };
  }

  const categoryText = labels.join(" / ");
  const segments = pathSegments(labels);
  let specificRule: Rule | undefined;
  let specificSource = "";
  let weakRule: Rule | undefined;
  let weakSource = "";
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index] ?? "";
    const rule = matchRules(segment);
    if (!rule) {
      continue;
    }
    if (WEAK_SEGMENT.test(segment.trim())) {
      if (!weakRule) {
        weakRule = rule;
        weakSource = segment;
      }
      continue;
    }
    specificRule = rule;
    specificSource = segment;
    break;
  }
  let fromCategory = specificRule ?? weakRule;
  let categorySource = specificRule ? specificSource : weakSource;
  let signal: MappedDepartment["signal"] = specificRule ? "specific" : fromCategory ? "broad" : "none";
  if (!fromCategory) {
    fromCategory = matchRules(categoryText);
    categorySource = categoryText;
    if (fromCategory) {
      signal = WEAK_SEGMENT.test(categorySource.trim()) || BROAD_CATEGORY.test(categorySource.trim()) ? "broad" : "specific";
    }
  }
  const fromName = matchRules(name);

  let rule = fromCategory ?? fromName;
  let reasonKind: "path" | "name" | "none" = fromCategory ? "path" : "none";
  let reasonSource = categorySource;
  const householdBeatsCare =
    fromCategory?.departmentId === "personal-care" && fromName?.departmentId === "household";
  if (
    fromCategory &&
    fromName &&
    fromName.departmentId !== fromCategory.departmentId &&
    (signal === "broad" || householdBeatsCare)
  ) {
    rule = fromName;
    signal = "name";
    reasonKind = "name";
    reasonSource = name;
  } else if (!fromCategory && fromName) {
    rule = fromName;
    signal = "name";
    reasonKind = "name";
    reasonSource = name;
  }

  const departmentId = rule?.departmentId ?? "other";
  const department = departmentById(departmentId) ?? DEPARTMENTS[DEPARTMENTS.length - 1];
  const sameDepartment = fromName?.departmentId === department.id ? fromName : undefined;
  const haystack = `${categoryText} ${name}`;
  if (department.id === "baby" && !isBabyConsumable(labels, name)) {
    return {
      departmentId: other.id,
      departmentName: other.name,
      signal: "excluded",
      reason: "baby:not diaper, wipe, formula, or baby food→other",
    };
  }
  return {
    departmentId: department.id,
    departmentName: department.name,
    subcategory: subcategoryFor(
      department.id,
      haystack,
      sameDepartment?.subcategory ?? rule?.subcategory ?? explicit?.subcategory
    ),
    signal,
    reason: reasonText(reasonKind, reasonSource, department.id),
  };
}
