import { escapeRegex } from "./escapeRegex";
import { stripPackageSizePhrases } from "./packageSize";

const STOP_WORDS = new Set(["of", "a", "an", "the"]);

const UNIT_WORDS = new Set([
  "oz",
  "floz",
  "fl",
  "lb",
  "lbs",
  "g",
  "kg",
  "ml",
  "l",
  "gal",
  "gallon",
  "quart",
  "qt",
  "pint",
  "pt",
  "count",
  "ct",
  "pk",
  "pack",
  "dozen",
  "liter",
  "litre",
  "gram",
  "pound",
  "ounce",
  "kilogram",
  "milliliter",
  "millilitre",
  "piece",
  "pc",
  "pcs",
  "ea",
  "each",
  "fluid",
]);

/**
 * Light plural stem so "eggs" matches "egg" and "Cheerios" matches itself.
 * Short tokens and words ending in "ss" are left alone.
 */
export function stemGroceryToken(token: string): string {
  const value = token.toLowerCase();
  if (value.length <= 3) {
    return value;
  }
  if (/(?:ches|shes|xes|zes|oes)$/.test(value)) {
    return value.slice(0, -2);
  }
  if (value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}

function isSkippableToken(token: string): boolean {
  if (/^\d+(?:\.\d+)?$/.test(token)) {
    return true;
  }
  const lower = token.toLowerCase();
  const stem = stemGroceryToken(token);
  return STOP_WORDS.has(lower) || STOP_WORDS.has(stem) || UNIT_WORDS.has(lower) || UNIT_WORDS.has(stem);
}

/**
 * Words used to search and score a grocery line. Size phrases ("12 oz",
 * "half gallon", "18 ct", "dozen") and filler words ("of", "a") are removed
 * so "gallon of milk" matches a jug titled "Whole Milk".
 */
export function groceryWordTokens(text: string): string[] {
  return tokenizeProductName(stripPackageSizePhrases(text)).filter(
    (token) => !isSkippableToken(token)
  );
}

const GENERIC_TRAILING_WORDS = new Set([
  "breakfast",
  "cereal",
  "food",
  "foods",
  "frozen",
  "snack",
  "snacks",
]);

const SERVING_SIZE_TOKEN = /^\d+(?:\.\d+)?(?:g|kg|oz|ml|l|lb|lbs|cal|kcal)$/i;

/**
 * FatSecret catalog names often append a serving annotation such as "(28g)"
 * or "(Cup)". Those are nutrition servings, not store SKU text.
 */
export function stripServingAnnotations(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a FatSecret / grocery product name into searchable word tokens.
 * "Honey Nut Cheerios Cereal" → ["Honey", "Nut", "Cheerios", "Cereal"]
 * "White Sandwich Bread (28g)" → ["White", "Sandwich", "Bread"]
 */
export function tokenizeProductName(name: string): string[] {
  return stripServingAnnotations(name)
    .split(/[^A-Za-z0-9%]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !SERVING_SIZE_TOKEN.test(token));
}

function dropGenericTrailing(tokens: string[]): string[] | null {
  if (tokens.length < 2) {
    return null;
  }
  const last = tokens[tokens.length - 1]?.toLowerCase();
  if (!last || !GENERIC_TRAILING_WORDS.has(last)) {
    return null;
  }
  return tokens.slice(0, -1);
}

/**
 * Token sets to match against a store product name, strongest first:
 * all keywords, then without a generic trailing word (Cereal), then the
 * first two words.
 */
export function matchTokenSets(name: string): string[][] {
  const tokens = groceryWordTokens(name);
  if (tokens.length === 0) {
    return [];
  }

  const sets: string[][] = [tokens];
  const withoutGeneric = dropGenericTrailing(tokens);
  if (withoutGeneric && withoutGeneric.length > 0) {
    sets.push(withoutGeneric);
  }
  if (tokens.length > 2) {
    sets.push(tokens.slice(0, 2));
  }
  return sets;
}

/**
 * Search strings to try in order: the cleaned full name, then the name
 * without a generic trailing word, then the first two words.
 */
export function productSearchAttempts(name: string): string[] {
  const attempts: string[] = [];
  for (const tokens of matchTokenSets(name)) {
    const query = tokens.join(" ");
    if (query && !attempts.includes(query)) {
      attempts.push(query);
    }
  }
  return attempts;
}

export function firstTwoWordQuery(name: string): string | null {
  const tokens = tokenizeProductName(name);
  if (tokens.length < 3) {
    return null;
  }
  return tokens.slice(0, 2).join(" ");
}

export function nameContainsAllTokens(productName: string, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return false;
  }
  const haystack = new Set(
    tokenizeProductName(productName).map((token) => stemGroceryToken(token))
  );
  return tokens.every((token) => haystack.has(stemGroceryToken(token)));
}

/**
 * Case-insensitive $regex AND of each keyword against Product.name.
 */
export function keywordNameFilter(tokens: string[]): Record<string, unknown> | null {
  if (tokens.length === 0) {
    return null;
  }

  const clauses = tokens.map((token) => ({
    name: { $regex: escapeRegex(token), $options: "i" },
  }));

  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}
