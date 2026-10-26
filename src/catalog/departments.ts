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
  /**
   * General merchandise (jewelry, electronics, furniture, and the other
   * non-grocery leftovers). Shopper browse and search hide this aisle
   * unless the department id is requested directly.
   */
  generalMerchandise?: boolean;
};

export const DEPARTMENTS: readonly Department[] = [
  { id: "produce", name: "Produce", subcategories: ["Fruit", "Vegetables", "Fresh Herbs"] },
  { id: "dairy-eggs", name: "Dairy & Eggs", subcategories: ["Milk", "Eggs", "Cheese", "Yogurt", "Butter"] },
  { id: "meat-seafood", name: "Meat & Seafood", subcategories: ["Chicken", "Beef", "Pork", "Seafood"] },
  { id: "bakery", name: "Bakery", subcategories: ["Bread", "Rolls & Bagels", "Tortillas"] },
  { id: "deli", name: "Deli", subcategories: ["Sliced Meat", "Prepared"] },
  { id: "pantry", name: "Pantry", subcategories: ["Pasta & Rice", "Canned", "Condiments", "Baking", "Nuts & Seeds", "Gifts"] },
  { id: "frozen", name: "Frozen", subcategories: ["Meals", "Vegetables", "Ice Cream"] },
  { id: "snacks", name: "Snacks", subcategories: ["Chips", "Crackers", "Candy"] },
  { id: "beverages", name: "Beverages", subcategories: ["Juice", "Soda", "Water", "Coffee & Tea"] },
  { id: "breakfast", name: "Breakfast", subcategories: ["Cereal", "Oatmeal"] },
  { id: "baby", name: "Baby", subcategories: ["Diapers", "Baby Food"] },
  { id: "household", name: "Household", subcategories: ["Paper", "Cleaning", "Laundry"] },
  { id: "personal-care", name: "Personal Care", subcategories: ["Hair", "Body", "Oral Care", "Health"] },
  { id: "pet", name: "Pet", subcategories: ["Dog", "Cat"] },
  { id: "other", name: "Other", subcategories: [], generalMerchandise: true },
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
  /** Vitamin and medicine segments. Skipped when the name is gear, a book, a pet, or a nutrition drink. */
  kind?: "health";
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
  { test: /^(?:meat\s*&\s*seafood|seafood)$/i, departmentId: "meat-seafood" },
  { test: /^poultry$/i, departmentId: "meat-seafood", subcategory: "Chicken" },
  { test: /^(?:fresh\s+)?produce$/i, departmentId: "produce" },
  { test: /^(?:fresh\s+)?fruits?$/i, departmentId: "produce", subcategory: "Fruit" },
  { test: /^(?:fresh\s+)?vegetables?$/i, departmentId: "produce", subcategory: "Vegetables" },
  { test: /^fresh herbs$/i, departmentId: "produce", subcategory: "Fresh Herbs" },
  { test: /^deli$/i, departmentId: "deli" },
  { test: /^prepared(?:\s+foods?)?$/i, departmentId: "deli", subcategory: "Prepared" },
  { test: /^(?:spices?(?:\s*(?:&|and)\s*seasonings?)?|seasonings?)$/i, departmentId: "pantry" },
  { test: /^baking(?:\s+(?:goods|ingredients|needs|supplies))?$/i, departmentId: "pantry", subcategory: "Baking" },
  { test: /^canned(?:\s*&\s*packaged|\s+(?:goods|foods?|vegetables|fruit|beans|meat))?$/i, departmentId: "pantry", subcategory: "Canned" },
  { test: /^(?:condiments?(?:\s*(?:&|and)\s*(?:sauces?|toppings))?|sauces?)$/i, departmentId: "pantry", subcategory: "Condiments" },
  { test: /^(?:international(?:\s+foods?)?|ethnic(?:\s+foods?)?|world foods?)$/i, departmentId: "pantry" },
  { test: /^(?:food gifts?|gift (?:baskets?|towers?|sets?)|gourmet gifts?)$/i, departmentId: "pantry", subcategory: "Gifts" },
  { test: /^(?:pasta|rice|grains?|soups?)$/i, departmentId: "pantry" },
  { test: /^(?:coffees?|teas?|coffee\s*(?:&|and)\s*tea)$/i, departmentId: "beverages", subcategory: "Coffee & Tea" },
  { test: /^(?:candy(?:\s*(?:&|and)\s*gum)?|gum)$/i, departmentId: "snacks", subcategory: "Candy" },
  { test: /^(?:mixers?|cocktail mixers?|drink mixes?)$/i, departmentId: "beverages" },
  { test: /^(?:nutrition (?:shakes?|drinks?|powders?)|meal replacements?)$/i, departmentId: "beverages" },
  { test: /^(?:beer|wine|spirits|liquor)$/i, departmentId: "beverages" },
  { test: /^(?:vitamins?(?:\s*(?:&|and)\s*supplements?)?|supplements?|digestive health|first aid|pain relievers?|diabetic supplies|cold (?:&|and) flu|antiseptics?)$/i, departmentId: "personal-care", subcategory: "Health", kind: "health" },
  { test: /^(?:letter vitamins|vitamin\s+[a-z](?:\s*complex)?|b[-\s]?complex|probiotics?|fish\s*oils?|melatonin|omega[-\s]?3|electrolytes?)$/i, departmentId: "personal-care", subcategory: "Health", kind: "health" },
  { test: /^(?:health|vitamins?|medicine|pharmacy)$/i, departmentId: "personal-care", kind: "health" },
  { test: /^personal care$/i, departmentId: "personal-care" },
  { test: /^(?:cleaning|cleaners?|cleaning tools?|janitorial(?:\s+supplies)?|cleaning chemicals?)$/i, departmentId: "household", subcategory: "Cleaning" },
  { test: /^(?:paper(?:\s+goods|\s+products)?|paper\s*(?:&|and)\s*plastics?|food-?\s*service(?:\s+disposables?)?|foodservice(?:\s+disposables?)?|disposables?)$/i, departmentId: "household", subcategory: "Paper" },
  { test: /^(?:household|household essentials?)$/i, departmentId: "household" },
  { test: /^(?:diapering|training pants|pull-?ups)$/i, departmentId: "baby", subcategory: "Diapers" },
  { test: /^(?:dog|cat)\s+(?:food|treats?|litter|bedding)$/i, departmentId: "pet" },
  { test: /baby back ribs?/i, departmentId: "meat-seafood", subcategory: "Pork" },
  { test: /carrot cake/i, departmentId: "bakery" },
  {
    test: /\bbaby\s+(?:carrots?|spinach|kale|bok choy|potatoes|potato|bella|portobell\w*|arugula|gem|broccoli|romaine|greens)\b/i,
    departmentId: "produce",
    subcategory: "Vegetables",
  },
  { test: /diaper(?!\s+pins?\b)|baby wipe|training pants|pull-?ups/i, departmentId: "baby", subcategory: "Diapers" },
  { test: /infant formula|baby formula|baby food(?!\s*makers?\b)/i, departmentId: "baby", subcategory: "Baby Food" },
  { test: /dog food|dog treats?|puppy food|puppy treats?/i, departmentId: "pet", subcategory: "Dog" },
  { test: /cat food|cat treats?|cat litter|kitten food/i, departmentId: "pet", subcategory: "Cat" },
  { test: /pet food|pet treats?/i, departmentId: "pet" },
  { test: /\b(?:dog|cat|pet|puppy|kitten|cedar|small animal)\s+bedding\b|\bcedar bedding\b/i, departmentId: "pet" },
  { test: /paper towel|toilet paper|bath tissue|paper napkin|paper plate|\bnapkins?\b|facial tissue|paper goods|plastic wrap|aluminum foil|sandwich bag/i, departmentId: "household", subcategory: "Paper" },
  { test: /dish soap|dish detergent|dishwasher|all-purpose cleaner|disinfect(?:ant|ing)|\bbleach\b|trash bag|garbage bag|\bsponges?\b/i, departmentId: "household", subcategory: "Cleaning" },
  { test: /laundry|detergent|fabric softener|dryer sheets?/i, departmentId: "household", subcategory: "Laundry" },
  { test: /household|cleaning supplies?|paper\s*(?:&|and)\s*plastic/i, departmentId: "household" },
  { test: /isopropyl alcohol|rubbing alcohol|test strips?|\bteething\b|\b(?:tylenol|advil|ibuprofen|acetaminophen|aspirin)\b/i, departmentId: "personal-care", subcategory: "Health", kind: "health" },
  { test: /\b(?:ensure|glucerna|pediasure)\b|\bnutrition(?:al)? (?:shakes?|drinks?|powders?)\b|\bmeal replacements?\b|\bprotein (?:shakes?|powders?)\b/i, departmentId: "beverages" },
  { test: /\bswiffer\b|\bdusters?\b|\bdegreasers?\b/i, departmentId: "household", subcategory: "Cleaning" },
  { test: /\bdixie\b|\bcup lids?\b/i, departmentId: "household", subcategory: "Paper" },
  { test: /\bgift (?:towers?|baskets?|sets?)\b/i, departmentId: "pantry", subcategory: "Gifts" },
  { test: /\b(?:ketchup|mustard|mayonnaise|salad dressing)\b/i, departmentId: "pantry", subcategory: "Condiments" },
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
  { test: /\beggnog\b/i, departmentId: "dairy-eggs" },
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
  /** True when the row stays in Other because it is general merchandise. */
  generalMerchandise?: boolean;
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
  /\b(?:wipe warmers?|breast pumps?|nursing covers?|sippy cups?|toddler plates?|sleep shorts?|food makers?|baby food makers?|bottle brushes?|bottle feed(?:ing|ers?)?|baby bottles?|pacifiers?|teethers?|strollers?|car\s*seats?|cribs?|crib sheets?|bassinets?|high\s*chairs?|playards?|play\s*yards?|baby\s*swings?|nursing pillows?|diaper\s*bags?|onesies|bodysuits?|baby monitors?|door\s*knob covers?|tableware)\b/i;

const BABY_CONSUMABLE =
  /\b(?:diapers?(?!\s+pins?\b)|diapering|training pants|pull-?ups|youth pants|bedwetting|baby wipes?|infant formula|baby formula|baby foods?(?!\s*makers?\b)|food pouches?)\b/i;

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
  // The product name wins when the leaf is wipes but the item is a brush.
  if (BABY_EQUIPMENT.test(name) || BABY_EQUIPMENT.test(focus)) {
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

/** Walmart roots that are not a grocery aisle. Matched on a whole segment. */
const GM_SEGMENT =
  /^(?:jewelry|fine jewelry|fashion jewelry|office supplies|office products|home improvement|personalized gifts|apparel|clothing|shoes|electronics|tvs?|video games?|toys|home decor|home décor|furniture|automotive|patio & garden|sports & outdoors|arts crafts & sewing|books|movies(?: & music)?|musical instruments|industrial & scientific|floral|tobacco|general merchandise)$/i;

/**
 * Seasonal, costume, pet-apparel, party, and decor leaves.
 * A whole segment or a phrase inside one segment. "Salad Dressings" does not match "dress".
 * These must not inherit Dairy & Eggs from an ancestor that says "Eggs".
 */
const MERCH_SEGMENT =
  /^(?:costumes?(?:\s*(?:&|and)\s*dress[-\s]?up)?|dress[-\s]?up|general merchandise|sweaters?|dress(?:es)?|decorations?|d[eé]cor|party(?:\s*(?:&|and)\s*occasions)?)$|\b(?:costumes?|dress[-\s]?up|pet\s+(?:apparel|clothing)|home\s*decor|home\s*d[eé]cor|decorations?|d[eé]cor|(?:dog|cat|pet|puppy|kitten)\s+(?:sweaters?|dress(?:es)?|costumes?|apparel|clothing|outfits?)|party\s+(?:supplies|decorations?|d[eé]cor|favors|goods)|party(?:\s*(?:&|and)\s*occasions))\b|\b(?:sweaters?|dress(?:es)?)\b/i;

/**
 * Holiday branches. Food leaves under them (candy, eggnog, baking) keep that leaf's aisle.
 * Ancestors above the branch, such as Dairy, Eggs & Cheese, do not.
 */
const SEASONAL_SEGMENT =
  /^(?:seasonal(?:\s*(?:&|and)\s*holiday)?(?:\s+grocery)?|holidays?|halloween|christmas|hanukkah|kwanzaa|thanksgiving|easter|valentine'?s?(?:\s+day)?|fourth of july|4th of july|new year'?s?)$/i;

/** Janitorial, food-service disposables, and named cleaning tools stay grocery under Industrial & Scientific. */
const INDUSTRIAL_EXCEPTION =
  /\b(?:janitorial|food-?\s*service|foodservice|cleaning chemicals?|disposables?|swiffer|dusters?|dixie|cup lids?|degreasers?)\b/i;

const HEALTH_DEVICE =
  /\b(?:massage(?:\s+guns?|\s+chairs?)?|gua sha|shower chairs?|air purifiers?|sound machines?|white noise machines?|sleep masks?|hot\s*(?:&|and)\s*cold packs?|heating pads?)\b/i;

const PET_ACCESSORY =
  /\b(?:toys?|wheels?|aquarium|ornaments?|feeders?|collars?|leashes|crates?|costumes?)\b/i;

const PET_CONSUMABLE =
  /\b(?:dog|cat|pet|puppy|kitten)\s+(?:food|foods|treats?)\b|\b(?:dog|cat|pet|kitty)\s+litter\b|\b(?:dog|cat|pet|puppy|kitten|cedar|small animal)\s+bedding\b|\bcedar bedding\b|\bcat litter\b/i;

/**
 * Non-grocery general merchandise. These stay in Other and are not crawled.
 * A janitorial or food-service leaf under Industrial & Scientific is grocery.
 */
function notGroceryLabel(categories: string[], name: string): string | null {
  const segments = pathSegments(categories);
  const leaf = segments.at(-1) ?? "";
  const focus = `${leaf} ${name}`;
  const text = `${segments.join(" ")} ${name}`;
  if (/\btestosterone\b/i.test(name)) {
    return "testosterone";
  }
  const device = focus.match(HEALTH_DEVICE);
  if (device) {
    return device[0].toLowerCase().replace(/\s+/g, " ");
  }
  const classic = focus.match(NOT_GROCERY) ?? text.match(/\b(?:video games?|xbox|playstation|nintendo)\b/i);
  if (classic) {
    const label = classic[0].toLowerCase();
    if (/video game|xbox|playstation|nintendo/.test(label)) {
      return "video game";
    }
    return "furniture";
  }
  const industrial = segments.some((segment) => /^industrial\s*&\s*scientific$/i.test(segment));
  const industrialGrocery = industrial && (segments.some((segment) => INDUSTRIAL_EXCEPTION.test(segment)) || INDUSTRIAL_EXCEPTION.test(name));
  if (!industrialGrocery) {
    for (const segment of segments) {
      const trimmed = segment.trim();
      if (GM_SEGMENT.test(trimmed) || MERCH_SEGMENT.test(trimmed)) {
        return trimmed.toLowerCase();
      }
    }
  }
  const petAisle = segments.some((segment) => /^(?:pets?|pet care|pet supplies)$/i.test(segment));
  const consumable = PET_CONSUMABLE.test(text);
  const accessory = focus.match(PET_ACCESSORY);
  if (accessory && !consumable && (petAisle || /\b(?:dog|cat|pet|puppy|kitten|aquarium|horse)\b/i.test(text))) {
    return accessory[0].toLowerCase();
  }
  return null;
}

function reasonText(kind: "path" | "name" | "none", source: string, departmentId: string): string {
  if (kind === "none") {
    return "none";
  }
  const label = source.replace(/\s+/g, " ").trim().slice(0, 48);
  return `${kind}:${label}→${departmentId}`;
}

function matchRules(text: string, skipHealth = false): Rule | undefined {
  if (!text.trim()) {
    return undefined;
  }
  return RULES.find((rule) => {
    if (skipHealth && rule.kind === "health") {
      return false;
    }
    return rule.test.test(text);
  });
}

/**
 * Words that name a swallowed health product. Omega-3 is separate: pantry
 * oils and seeds say "high in omega-3" without being a supplement.
 */
const HEALTH_CONSUMABLE_NOUN =
  /\b(?:multivitamins?|vitamins?|b[-\s]?complex(?:es)?|supplements?|probiotics?|fish\s*oils?|melatonin|electrolytes?)\b/i;

const OMEGA3 = /\bomega[-\s]?3s?\b/i;

/** Dosage forms that pair with a supplement brand. Caplets and chewables are the same class as tablets. */
const DOSAGE_FORM = /\b(?:tablets?|tabs?|capsules?|soft\s*gels?|gummies|gummy|caplets?|chewables?|chews)\b/i;

/** Olly and One A Day need a dosage form. The other names are only vitamins, but the same pairing avoids cookware and nameplates. */
const HEALTH_BRAND =
  /\b(?:nature made|nature['’]?s bounty|centrum|one a day|olly|vitafusion|nordic naturals|garden of life)\b/i;

const PILL_GEAR =
  /\b(?:pill|vitamin|supplement|medicine|medication)s?\s+(?:organizers?|planners?|boxes|cases|holders?|dispensers?|splitters?|cutters?|crushers?)\b/i;

const NUTRITION_DRINK =
  /\b(?:ensure|glucerna|pediasure)\b|\bnutrition(?:al)? (?:shakes?|drinks?|powders?)\b|\bmeal replacements?\b|\bboost\s+glucose\b|\bprotein\b[^.]{0,40}\b(?:shakes?|powders?)\b|\b(?:shakes?|powders?)\b[^.]{0,40}\bprotein\b/i;

const TOPICAL_CARE = /\b(?:lip\s*care|lip\s*balms?|cocoa butter|lotions?|body butters?|moisturizers?|soaps?)\b/i;

/** Creams and ointments. Gels stay with tablets so glucose gel and liquid gels stay oral. */
const TOPICAL_MEDICINE = /\b(?:creams?|ointments?|lotions?|balms?|anti-?itch)\b/i;

const ALLERGY_DRUG =
  /\b(?:diphenhydramine|cetirizine|loratadine|fexofenadine|zyrtec|claritin|allegra|benadryl)\b/i;

const ALLERGY_RELIEF = /\ballergy\b(?:\s+\w+){0,3}\s+relief\b/i;

const HERB =
  /\b(?:echinacea|black cohosh|saw palmetto|quercetin|co[\s-]?q[\s-]?10|coq10|turmeric|curcumin|ashwagandha|elderberry|elder berries)\b/i;

const MINERAL = /\b(?:potassium|magnesium|zinc|calcium|iron|ferrous)\b/i;

const MINERAL_GEAR = /\b(?:t-?shirts?|skillets?|pans?\b|woks?|cast iron|iron man|graphic tee|graphic t)\b/i;

/** A count such as 60ct stands in for a dosage form on a supplement brand. */
const COUNT_FORM = /\b\d+\s*ct\b|\bcount\b/i;

const SINGLE_WORD_SUPPLEMENT_BRAND = /\b(?:bulksupplements|now foods)\b/i;

const SEED_PANTRY = /\b(?:flax\s*seeds?|flaxseeds?|chia\s*seeds?|hemp\s*seeds?|hemp hearts)\b/i;

/**
 * Pet medicines and pet food. Bare "fish" is not a pet (fish oil is human).
 * Bare "cat" is not a pet ("cat's claw" is an herb). "Horse chestnut" is an herb.
 */
function petHealthContext(name: string): boolean {
  if (/\bfood spray\b/i.test(name)) {
    return true;
  }
  const withoutHerb = name.replace(/\bhorse chestnut\b/gi, " ");
  if (/\b(?:dogs?|puppies|kittens?|horses?|birds?|turtles?|hamsters?|guinea pigs?|goldfish|bearded dragons?|hermit crabs?|hedgehogs?|reptiles?|felines?|canines?)\b/i.test(withoutHerb)) {
    return true;
  }
  return /\bfor\s+cats?\b|\bcats?\s+(?:food|foods|treats?|vitamins?|supplements?)\b|\bpet\s+(?:products?|food|tabs|vitamins?|supplements?)\b|\b(?:fish|turtle|bird|hamster|guinea pig)\s+food\b|\bsmall animals?\b/i.test(name);
}

function looksLikeBook(name: string): boolean {
  if (/\b(?:paperback|hardcover|audiobook|step-by-step guide|handbook)\b/i.test(name)) {
    return true;
  }
  return (
    name.includes(":") &&
    !DOSAGE_FORM.test(name) &&
    !HEALTH_BRAND.test(name) &&
    /\b(?:your|guide|overcome|handbook|edition)\b/i.test(name)
  );
}

type HealthNameIntent = { intent: "health" | "body" | "block"; label: string };

function supplementBrand(name: string): boolean {
  if (/\bnordic ware\b/i.test(name)) {
    return false;
  }
  if (/\b(?:holly|jolly)\b/i.test(name) && !/\bolly\b/i.test(name)) {
    return false;
  }
  return HEALTH_BRAND.test(name);
}

function allergyMedicine(name: string): boolean {
  if (/\ballergy[-\s]free\b/i.test(name) && !ALLERGY_DRUG.test(name)) {
    return false;
  }
  if (ALLERGY_DRUG.test(name) || ALLERGY_RELIEF.test(name)) {
    return true;
  }
  return /\bantihistamines?\b/i.test(name) && (DOSAGE_FORM.test(name) || COUNT_FORM.test(name));
}

function mineralSupplement(name: string): boolean {
  if (!MINERAL.test(name) || !DOSAGE_FORM.test(name) || MINERAL_GEAR.test(name)) {
    return false;
  }
  return true;
}

function departmentFromName(id: string, label: string, subcategory?: string): MappedDepartment {
  const department = departmentById(id) ?? DEPARTMENTS[DEPARTMENTS.length - 1];
  return {
    departmentId: department.id,
    departmentName: department.name,
    ...(subcategory ? { subcategory } : {}),
    signal: department.id === "other" ? "excluded" : "name",
    ...(department.id === "other" ? { generalMerchandise: true } : {}),
    reason: `name:${label}→${department.id}`,
  };
}

function personalCareFromName(subcategory: "Health" | "Body", label: string): MappedDepartment {
  return departmentFromName("personal-care", label, subcategory);
}

/**
 * Dog and cat food, treats, litter, and pet vitamins win over a Toys path.
 * Litter-Robot gear and pet toys stay on the general-merchandise path.
 * "Cat's claw" and "horse chestnut" are herbs.
 */
function petNameOverride(name: string): MappedDepartment | null {
  if (/\blitter[-\s]*robot\b/i.test(name) || /\blitter\s*(?:box(?:es)?|mats?|genie|scoops?)\b/i.test(name)) {
    return null;
  }
  if (/\b(?:dog|puppy)\s+(?:foods?|treats?)\b/i.test(name)) {
    return departmentFromName("pet", "pet-food", "Dog");
  }
  if (/\b(?:cat|kitten|kitty)\s+(?:foods?|treats?)\b/i.test(name)) {
    return departmentFromName("pet", "pet-food", "Cat");
  }
  if (/\b(?:cat|kitty|pet|clumping|crystal)\s+litter\b/i.test(name)) {
    return departmentFromName("pet", "pet-litter", "Cat");
  }
  if (/\b(?:fish|bird|turtle|hamster|guinea pig)\s+food\b/i.test(name)) {
    return departmentFromName("pet", "pet-food");
  }
  const withoutHerb = name.replace(/\b(?:horse chestnut|cat'?s\s+claw)\b/gi, " ");
  const dog = /\b(?:dogs?|puppies)\b/i.test(withoutHerb);
  const cat = /\b(?:cats?|kittens?)\b/i.test(withoutHerb);
  const otherAnimal = /\b(?:horses?|birds?|hamsters?|guinea pigs?|goldfish|reptiles?)\b/i.test(withoutHerb);
  const supplementish = /\b(?:vitamins?|multivitamins?|supplements?|fish\s*oils?)\b/i.test(withoutHerb);
  if (supplementish && (dog || cat || otherAnimal)) {
    const subcategory = dog ? "Dog" : cat ? "Cat" : undefined;
    return departmentFromName("pet", "pet-vitamin", subcategory);
  }
  return null;
}

/**
 * Name-only health consumable decision. "block" means a vitamin segment
 * must not pull the row into personal care (books, pets, formula,
 * testosterone, devices, pill gear).
 */
function healthNameIntent(name: string): HealthNameIntent | null {
  const text = name.trim();
  if (!text) {
    return null;
  }
  if (looksLikeBook(text)) {
    return { intent: "block", label: "book" };
  }
  if (/\btestosterone\b/i.test(text) || HEALTH_DEVICE.test(text)) {
    return { intent: "block", label: "device" };
  }
  // A vitamin path must not turn formula, a shake, or a pet medicine into Health.
  if (petHealthContext(text) || NUTRITION_DRINK.test(text) || BABY_CONSUMABLE.test(text)) {
    return { intent: "block", label: "kept" };
  }
  if (/\bserums?\b/i.test(text)) {
    return { intent: "body", label: "skincare-serum" };
  }
  if (allergyMedicine(text) && TOPICAL_MEDICINE.test(text)) {
    return { intent: "body", label: "topical" };
  }
  if (TOPICAL_CARE.test(text) && !DOSAGE_FORM.test(text) && (HEALTH_CONSUMABLE_NOUN.test(text) || supplementBrand(text))) {
    return { intent: "body", label: "skincare-serum" };
  }
  if (allergyMedicine(text)) {
    return { intent: "health", label: "allergy" };
  }
  if (/\bglucose\b/i.test(text) && (DOSAGE_FORM.test(text) || /\bgels?\b/i.test(text))) {
    return { intent: "health", label: "glucose" };
  }
  if ((HERB.test(text) || mineralSupplement(text)) && DOSAGE_FORM.test(text)) {
    return { intent: "health", label: "herbal-mineral" };
  }
  if (SINGLE_WORD_SUPPLEMENT_BRAND.test(text) && /\b(?:powders?|capsules?|tablets?|soft\s*gels?|gummies|caplets?)\b/i.test(text)) {
    return { intent: "health", label: "supplement-brand" };
  }
  const omegaConsumable =
    OMEGA3.test(text) &&
    (DOSAGE_FORM.test(text) || /\bsupplements?\b/i.test(text) || /\bfish\s*oils?\b/i.test(text) || supplementBrand(text));
  const foodCarrier =
    /\b(?:yogurts?|kefirs?|kombuchas?|kimchi|sauerkraut|sardines?)\b/i.test(text) &&
    !DOSAGE_FORM.test(text) &&
    !supplementBrand(text);
  const noun = HEALTH_CONSUMABLE_NOUN.test(text) && !foodCarrier;
  if (noun || omegaConsumable || (supplementBrand(text) && (DOSAGE_FORM.test(text) || COUNT_FORM.test(text)))) {
    return { intent: "health", label: "health-consumable" };
  }
  if (PILL_GEAR.test(text)) {
    return { intent: "block", label: "pill-gear" };
  }
  return null;
}

const PET_NAME = "dogs?|cats?|pets?|puppies|kittens?";
const APPAREL_NAME =
  "sweaters?|sweatshirts?|hoodies?|dress(?:es)?|costumes?|outfits?|jackets?|coats?|shirts?|tees?|pajamas?|pyjamas?|vests?|booties|shoes?|hats?|bandanas?|apparel|clothing|clothes";

const PET_APPAREL_NAME = new RegExp(
  `\\b(?:${PET_NAME})\\b(?:\\s+\\w+){0,5}\\s+(?:${APPAREL_NAME})\\b|\\b(?:${APPAREL_NAME})\\b(?:\\s+\\w+){0,5}\\s+(?:${PET_NAME})\\b`,
  "i"
);
const PET_TOY_NAME = new RegExp(
  `\\b(?:${PET_NAME})\\b(?:\\s+\\w+){0,4}\\s+(?:toys?|plush)\\b|\\b(?:toys?|plush)\\b(?:\\s+\\w+){0,4}\\s+(?:${PET_NAME})\\b`,
  "i"
);
const COSTUME_NAME = /\bcostumes?\b/i;
const DECOR_NAME =
  /\b(?:home\s*decor|home\s*d[eé]cor|halloween\s*decor|party\s*decor|table\s*decor|wall\s*decor|decorations?|d[eé]cor)\b/i;
const PLAIN_APPAREL_NAME = /\b(?:sweaters?|sweatshirts?|hoodies?|dress(?:es)?)\b/i;

export type SuspiciousHint = "pet-apparel" | "pet-toy" | "costume" | "decor" | "apparel";

/**
 * Obviously non-grocery titles: pet clothes, costumes, sweaters, dresses, toys, and decor.
 * "Pumpkin" alone is not a hint. Pumpkin puree and pumpkin seeds stay food.
 * Word boundaries keep "dressing" and "teething" out.
 */
export function suspiciousNonGroceryHint(name: string): SuspiciousHint | null {
  const text = name.trim();
  if (!text) {
    return null;
  }
  if (PET_APPAREL_NAME.test(text)) {
    return "pet-apparel";
  }
  if (PET_TOY_NAME.test(text)) {
    return "pet-toy";
  }
  if (COSTUME_NAME.test(text)) {
    return "costume";
  }
  if (DECOR_NAME.test(text)) {
    return "decor";
  }
  if (PLAIN_APPAREL_NAME.test(text)) {
    return "apparel";
  }
  return null;
}

/** Same hints, for the admin audit query. */
export const SUSPICIOUS_NON_GROCERY_NAME = new RegExp(
  [PET_APPAREL_NAME.source, PET_TOY_NAME.source, COSTUME_NAME.source, DECOR_NAME.source, PLAIN_APPAREL_NAME.source].join("|"),
  "i"
);

/**
 * Name wins over the stored path for the misses that were still in Other.
 * Returns a department, or null when the usual path rules should run.
 * blockHealth is true when a vitamin segment must not apply.
 */
function nameOverride(name: string): { mapped: MappedDepartment; blockHealth: boolean } | { mapped?: undefined; blockHealth: boolean } {
  const text = name.trim();
  if (!text) {
    return { blockHealth: false };
  }
  if (/\bdiaper\s+pins?\b/i.test(text)) {
    return { mapped: departmentFromName("other", "diaper-pins"), blockHealth: true };
  }
  if (/\blitter[-\s]*robot\b/i.test(text)) {
    return { mapped: departmentFromName("other", "litter-robot"), blockHealth: true };
  }
  if (looksLikeBook(text) && /\bgift (?:towers?|baskets?|sets?)\b/i.test(text)) {
    return { mapped: departmentFromName("other", "gift-book"), blockHealth: true };
  }
  const pet = petNameOverride(text);
  if (pet) {
    return { mapped: pet, blockHealth: true };
  }
  const hint = suspiciousNonGroceryHint(text);
  if (hint) {
    return { mapped: departmentFromName("other", hint), blockHealth: true };
  }
  if (/\b(?:training pants|pull-?ups)\b/i.test(text)) {
    return { mapped: departmentFromName("baby", "training-pants", "Diapers"), blockHealth: true };
  }
  if (NUTRITION_DRINK.test(text)) {
    return { mapped: departmentFromName("beverages", "nutrition-drink"), blockHealth: true };
  }
  const seedFood = /\b(?:crackers?|chips?|cookies?|breads?|bars?|muffins?|oils?|pillows?|masks?)\b/i.test(text);
  if (SEED_PANTRY.test(text) && !seedFood && !(DOSAGE_FORM.test(text) && /\b(?:oils?|supplements?)\b/i.test(text))) {
    return { mapped: departmentFromName("pantry", "seeds", "Nuts & Seeds"), blockHealth: true };
  }
  const health = healthNameIntent(text);
  if (health?.intent === "health") {
    return { mapped: personalCareFromName("Health", health.label), blockHealth: false };
  }
  if (health?.intent === "body") {
    return { mapped: personalCareFromName("Body", health.label), blockHealth: false };
  }
  return { blockHealth: health?.intent === "block" };
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
  const named = nameOverride(name);
  if (named.mapped) {
    return named.mapped;
  }
  const skipHealth = named.blockHealth;
  const junk = notGroceryLabel(labels, name);
  if (junk) {
    return {
      departmentId: other.id,
      departmentName: other.name,
      signal: "excluded",
      generalMerchandise: true,
      reason: `not-grocery:${junk}→other`,
    };
  }
  const gear = babyGearLabel(labels, name);
  if (gear) {
    return {
      departmentId: other.id,
      departmentName: other.name,
      signal: "excluded",
      generalMerchandise: true,
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

  const allSegments = pathSegments(labels);
  // A Halloween leaf under Dairy, Eggs & Cheese used to inherit "Eggs" and get crawled as dairy.
  const seasonalAt = allSegments.findIndex((segment) => SEASONAL_SEGMENT.test(segment.trim()));
  const segments = seasonalAt > 0 ? allSegments.slice(seasonalAt) : allSegments;
  const categoryText = seasonalAt >= 0 ? segments.join(" / ") : labels.join(" / ");
  let specificRule: Rule | undefined;
  let specificSource = "";
  let weakRule: Rule | undefined;
  let weakSource = "";
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index] ?? "";
    const rule = matchRules(segment, skipHealth);
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
    fromCategory = matchRules(categoryText, skipHealth);
    categorySource = categoryText;
    if (fromCategory) {
      signal = WEAK_SEGMENT.test(categorySource.trim()) || BROAD_CATEGORY.test(categorySource.trim()) ? "broad" : "specific";
    }
  }
  const fromName = matchRules(name, skipHealth);

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
  // Baby/Health is nursery gear, not the Health and Medicine aisle. A named
  // consumable (teething relief, Tylenol) can still land in personal care.
  const genericBabyHealth = /^(?:personal care|health|medicine|pharmacy|toddler medicine)$/i.test(
    specificSource.trim()
  );
  const namedHealthConsumable = fromName?.departmentId === "personal-care";
  const babyNonConsumable = !isBabyConsumable(labels, name);
  if (department.id === "baby" && babyNonConsumable) {
    return {
      departmentId: other.id,
      departmentName: other.name,
      signal: "excluded",
      generalMerchandise: true,
      reason: "baby:not diaper, wipe, formula, or baby food→other",
    };
  }
  if (
    department.id === "personal-care" &&
    inBabyDepartment(labels) &&
    babyNonConsumable &&
    genericBabyHealth &&
    !namedHealthConsumable
  ) {
    return {
      departmentId: other.id,
      departmentName: other.name,
      signal: "excluded",
      generalMerchandise: true,
      reason: "baby:not diaper, wipe, formula, or baby food→other",
    };
  }
  if (seasonalAt >= 0 && department.id === "other") {
    return {
      departmentId: other.id,
      departmentName: other.name,
      signal: "excluded",
      generalMerchandise: true,
      reason: "not-grocery:seasonal→other",
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
    ...(department.id === "other" ? { generalMerchandise: true } : {}),
    reason: reasonText(reasonKind, reasonSource, department.id),
  };
}

export type HealthConsumableMoveCount = {
  examined: number;
  /** personal-care / Health via the name rule. */
  toHealth: number;
  /** personal-care / Body via the serum exception. */
  toBody: number;
  /** Not moved by this rule. Path rules and false friends stay here. */
  stayed: number;
};

/**
 * Dry-run for masters stored in Other.
 * A row counts as a move only when the name rule (or the serum exception)
 * returns personal care. Recategorize writes that department and clears
 * refreshExcluded on the product's offers. A row that stays in Other has the
 * flag set. `updated` is masters whose
 * department or subcategory changes. `clearedExclusions` is offers that
 * had the flag, which is not the same number as masters.
 * Keyword search totals are an upper bound: they include books, pet
 * medicines, pill organizers, and foods that this count leaves in place.
 */
export function countHealthConsumableMoves(
  rows: readonly { name: string; categories?: string[]; departmentId?: string }[]
): HealthConsumableMoveCount {
  let examined = 0;
  let toHealth = 0;
  let toBody = 0;
  let stayed = 0;
  for (const row of rows) {
    if ((row.departmentId ?? "other").trim().toLowerCase() !== "other") {
      continue;
    }
    examined += 1;
    const mapped = mapToDepartment(row.categories, row.name);
    if (mapped.departmentId === "personal-care" && mapped.reason?.includes("health-consumable")) {
      toHealth += 1;
    } else if (mapped.departmentId === "personal-care" && mapped.reason?.includes("skincare-serum")) {
      toBody += 1;
    } else {
      stayed += 1;
    }
  }
  return { examined, toHealth, toBody, stayed };
}

export type NameMoveCount = {
  examined: number;
  stayed: number;
  byRule: Record<string, number>;
};

/**
 * Count Other rows by the name rule that moves them.
 * `byRule` keys are the label in `name:<label>→department`.
 * Recategorize writes the new department, clears refreshExcluded when the
 * product leaves Other, and sets it when the product lands in Other.
 * `updated` counts masters whose department
 * or subcategory changes. `clearedExclusions` counts offers that had
 * the flag. Keyword totals count false friends, so they are an upper bound.
 */
export function countNameMoves(
  rows: readonly { name: string; categories?: string[]; departmentId?: string }[]
): NameMoveCount {
  const byRule: Record<string, number> = {};
  let examined = 0;
  let stayed = 0;
  for (const row of rows) {
    if ((row.departmentId ?? "other").trim().toLowerCase() !== "other") {
      continue;
    }
    examined += 1;
    const mapped = mapToDepartment(row.categories, row.name);
    const label = mapped.reason?.match(/^name:([^→ ]+)→/)?.[1];
    if (!label || mapped.departmentId === "other") {
      stayed += 1;
      continue;
    }
    byRule[label] = (byRule[label] ?? 0) + 1;
  }
  return { examined, stayed, byRule };
}
