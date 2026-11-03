/**
 * Grocery-store scope for the Walmart crawl, department mapping, Kroger
 * lookup, and the admin deactivate job.
 *
 * The lists are the rule. A Walmart taxonomy segment is denied or allowed by
 * the tables below. Product names use the same tables so a durable good filed
 * under a grocery leaf does not stay in the catalog.
 *
 * Keep what a person buys at a grocery store: food, drinks, cleaning, paper,
 * laundry and dish detergent, trash bags, foil and storage bags, personal
 * care, baby consumables, pet food, OTC, batteries, and light bulbs.
 * Leave out appliances, furniture, storage furniture, electronics, movies,
 * books, apparel, tools, automotive, outdoor, and services such as Appliance
 * Delivery.
 */

export type ScopeRule = {
  id: string;
  /** Whole segment, or a phrase that only means this durable good. */
  test: RegExp;
};

/**
 * Walmart category segments that are not a grocery aisle.
 * Matched against one path segment. "Laundry" does not match
 * "Laundry Storage and Organization". "Dishwasher Detergent" does not match
 * "Dishwashers".
 */
export const WALMART_CATEGORY_DENY: readonly ScopeRule[] = [
  { id: "appliance-delivery", test: /^(?:appliance delivery|home services|assembly services?)$/i },
  {
    id: "appliances",
    test: /^(?:appliances?|dishwashers?|refrigerators?|freezers?|microwaves?|ranges?|cooktops?|wall ovens?|washers?\s*(?:&|and)\s*dryers?)$/i,
  },
  {
    id: "laundry-storage",
    test: /\blaundry\b.*\b(?:storage|organization)\b|\bstorage\b.*\borganization\b|\bhome organization\b|\bcloset organization\b/i,
  },
  { id: "furniture", test: /^(?:furniture|mattresses?|home decor|home décor)$/i },
  { id: "electronics", test: /^(?:electronics|tvs?|video games?)$/i },
  {
    id: "movies",
    test: /^(?:movies(?:\s*(?:&|and)\s*music)?|music|books|films?)$|\bfrozen movies\b|\bmovies?\b.*\bfrozen\b|\bfrozen\b.*\bmovies?\b/i,
  },
  { id: "apparel", test: /^(?:apparel|clothing|shoes)$/i },
  { id: "tools", test: /^(?:tools?)$/i },
  { id: "auto", test: /^(?:auto(?:\s*&\s*tires)?|automotive|tires?(?:\s*&\s*wheels)?|rv|rvs)$/i },
  { id: "outdoor", test: /^(?:patio(?:\s*&\s*garden)?|outdoor(?:\s+(?:living|patio))?|outdoors|lawn\s*&\s*garden)$/i },
];

/**
 * Segments that stay even when a neighbor looks like general merchandise.
 * A denied ancestor (Auto & Tires / Cleaners) still wins. These names must
 * not be dropped from the crawl.
 */
export const WALMART_CATEGORY_ALLOW: readonly string[] = [
  "Cleaning Supplies",
  "Cleaning",
  "Cleaners",
  "Paper & Plastic",
  "Paper Goods",
  "Paper Towels",
  "Toilet Paper",
  "Facial Tissue",
  "Napkins",
  "Laundry",
  "Laundry Detergent",
  "Dish Soap",
  "Trash Bags",
  "Diapers",
  "Baby Food",
  "Formula",
  "Baby Wipes",
  "Training Pants",
  "Dog Food",
  "Cat Food",
  "Cat Litter",
  "Vitamins",
  "Personal Care",
  "Health",
  "Batteries",
  "Light Bulbs",
  "Aluminum Foil",
  "Food Storage Bags",
  "Household Essentials",
];

const ALLOW_KEYS = new Set(WALMART_CATEGORY_ALLOW.map((entry) => entry.toLowerCase()));

/**
 * A product name that is still a grocery consumable, even when the word
 * "dishwasher", "laundry", or "storage" appears in it.
 */
export const GROCERY_CONSUMABLE_NAME =
  /\b(?:detergents?|dish soap|dishwasher\s+(?:detergent|soap|pods?|pacs?|tablets?)|laundry\s+(?:detergent|pods?|pacs?)|paper towels?|toilet paper|bath tissue|facial tissues?|paper plates?|napkins?|trash bags?|garbage bags?|aluminum foil|plastic wrap|storage bags?|sandwich bags?|freezer bags?|diapers?|baby wipes?|infant formula|baby formula|dog foods?|cat foods?|cat litter|batteries|light bulbs?|led bulbs?)\b/i;

/** Durable-good titles. Checked only when the name is not a consumable above. */
export const WALMART_NAME_DENY: readonly ScopeRule[] = [
  { id: "appliance-delivery", test: /\bappliance delivery\b|\b(?:furniture|mattress|appliance)\s+delivery\b/i },
  { id: "movies", test: /\b(?:dvds?|blu-?rays?|4k ultra hd)\b|\bfrozen movies\b/i },
  {
    id: "appliances",
    test: /\b(?:dishwashers?|refrigerators?|microwaves?|wall ovens?|cooktops?|gas ranges?|electric ranges?|kitchen ranges?)\b/i,
  },
  {
    id: "storage-furniture",
    test: /\b(?:closet organizers?|storage cabinets?|shelving units?|bookcases?|dressers?)\b/i,
  },
  { id: "furniture", test: /\b(?:sofas?|couches?|mattresses?|nightstands?|sectionals?)\b/i },
  { id: "electronics", test: /\b(?:televisions?|laptops?|headphones?)\b|\b\d{2,3}\s*(?:inch|in)\s+tvs?\b/i },
];

function segmentsOf(categories: string[]): string[] {
  const segments: string[] = [];
  for (const entry of categories) {
    for (const part of entry.split(/\s*(?:\/|>)\s*/)) {
      const trimmed = part.trim();
      if (trimmed) segments.push(trimmed);
    }
  }
  return segments;
}

export function categoryAllowed(segment: string): boolean {
  return ALLOW_KEYS.has(segment.trim().toLowerCase());
}

/**
 * Why this category path or product name is outside a grocery store.
 * Null means the usual department rules decide (food, cleaning, paper, and
 * the rest of the allow list).
 */
export function groceryScopeDenial(categories: string[] | undefined, name: string): string | null {
  const title = name.trim();
  if (title && GROCERY_CONSUMABLE_NAME.test(title)) {
    return null;
  }
  if (title) {
    for (const rule of WALMART_NAME_DENY) {
      if (rule.test.test(title)) return rule.id;
    }
  }
  let deny: string | null = null;
  for (const segment of segmentsOf(categories ?? [])) {
    if (categoryAllowed(segment)) continue;
    if (GROCERY_CONSUMABLE_NAME.test(segment)) continue;
    for (const rule of WALMART_CATEGORY_DENY) {
      if (rule.test.test(segment)) deny = rule.id;
    }
  }
  return deny;
}
