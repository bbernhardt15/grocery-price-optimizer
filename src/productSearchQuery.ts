import { escapeRegex } from "./escapeRegex";

/**
 * Split a FatSecret / grocery product name into searchable word tokens.
 * "Honey Nut Cheerios Cereal" → ["Honey", "Nut", "Cheerios", "Cereal"]
 */
export function tokenizeProductName(name: string): string[] {
  return name
    .trim()
    .split(/[^A-Za-z0-9%]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Search strings to try in order: the full tokenized name, then the first two
 * words when the name is longer than that (e.g. "Honey Nut").
 */
export function productSearchAttempts(name: string): string[] {
  const tokens = tokenizeProductName(name);
  if (tokens.length === 0) {
    return [];
  }

  const attempts = [tokens.join(" ")];
  if (tokens.length > 2) {
    attempts.push(tokens.slice(0, 2).join(" "));
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
  const haystack = productName.toLowerCase();
  return tokens.every((token) => haystack.includes(token.toLowerCase()));
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
