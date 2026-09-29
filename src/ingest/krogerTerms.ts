/**
 * Search terms for Kroger, which has no category browse.
 * `filter.term` plus optional `filter.brand`. Expand this list to deepen a department.
 * TERMS_VERSION is stored on the checkpoint; bump it when the list changes shape
 * so a resume does not skip ahead on a stale index.
 */

export const KROGER_TERMS_VERSION = 2;

/**
 * `filter.start` is how many rows to skip. The first page omits it
 * (checkpoint start 0). Kroger rejects a sent value outside 1..250
 * (PRODUCT-2021), so 250 is the last legal skip and 300 is never sent.
 * That is a skip count, not a 1-based item index: a full page of 50
 * advances 0 → 50 → 100 → 150 → 200 → 250, then the term stops.
 */
export const KROGER_START_MAX = 250;

/** Brand queries queued when a broad term fills the start window. */
export const KROGER_BRAND_SPLIT_LIMIT = 6;

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
  { departmentId: "household", subcategory: "Laundry", term: "dryer sheets" },
  { departmentId: "household", subcategory: "Cleaning", term: "trash bags" },
  { departmentId: "household", subcategory: "Cleaning", term: "all purpose cleaner" },
  { departmentId: "household", subcategory: "Paper", term: "paper napkins" },
  { departmentId: "household", subcategory: "Paper", term: "facial tissue" },
  { departmentId: "personal-care", subcategory: "Hair", term: "shampoo" },
  { departmentId: "personal-care", subcategory: "Body", term: "body wash" },
  { departmentId: "personal-care", subcategory: "Body", term: "bar soap" },
  { departmentId: "personal-care", subcategory: "Oral Care", term: "toothpaste" },
  { departmentId: "pet", subcategory: "Dog", term: "dog food" },
  { departmentId: "pet", subcategory: "Dog", term: "dry dog food" },
  { departmentId: "pet", subcategory: "Dog", term: "wet dog food" },
  { departmentId: "pet", subcategory: "Cat", term: "cat food" },
  { departmentId: "pet", subcategory: "Cat", term: "dry cat food" },
  { departmentId: "pet", subcategory: "Cat", term: "wet cat food" },
];

export type KrogerQuery = {
  term: KrogerIngestTerm;
  brand?: string;
  termIndex: number;
  brandIndex: number;
};

/**
 * Kroger returns 400 for a filter value it will not parse. Keep letters,
 * digits, and the few punctuation marks that show up in real brand names.
 */
export function sanitizeKrogerParam(value: string | undefined, maxLength: number): string | null {
  if (!value) {
    return null;
  }
  const cleaned = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s'&./+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : null;
}

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

export type KrogerStartParam =
  | { action: "omit" }
  | { action: "send"; value: number }
  | { action: "too-high" };

/**
 * What to put in `filter.start`.
 * Below 1 (including the checkpoint's 0) is the first page: omit the field.
 * 1..250 is a skip count the Products API accepts.
 * Above 250 must not be sent.
 */
export function krogerStartParam(start: number | undefined): KrogerStartParam {
  if (start === undefined || !Number.isFinite(start) || start < 1) {
    return { action: "omit" };
  }
  const value = Math.floor(start);
  if (value > KROGER_START_MAX) {
    return { action: "too-high" };
  }
  return { action: "send", value };
}

export type KrogerAdvanceKind = "page" | "short" | "page-cap" | "start-ceiling";

export function krogerAdvance(
  start: number,
  limit: number,
  returned: number,
  pageIndex: number,
  maxPages: number
): { kind: KrogerAdvanceKind; start: number | null } {
  if (returned < limit) {
    return { kind: "short", start: null };
  }
  const next = start + returned;
  if (next > KROGER_START_MAX) {
    return { kind: "start-ceiling", start: null };
  }
  if (pageIndex + 1 >= maxPages) {
    return { kind: "page-cap", start: null };
  }
  return { kind: "page", start: next };
}

export function nextKrogerStart(
  start: number,
  limit: number,
  returned: number,
  pageIndex: number,
  maxPages: number
): number | null {
  return krogerAdvance(start, limit, returned, pageIndex, maxPages).start;
}

/** Distinct brand names to search after an unbranded term hits the start ceiling. */
export function pickBrandSplits(
  brands: string[] | undefined,
  skip: string[] = [],
  limit = KROGER_BRAND_SPLIT_LIMIT
): string[] {
  const skipKeys = new Set(skip.map((brand) => brand.trim().toLowerCase()).filter(Boolean));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const brand of brands ?? []) {
    const cleaned = sanitizeKrogerParam(brand, 40);
    if (!cleaned) {
      continue;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key) || skipKeys.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(cleaned);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}
