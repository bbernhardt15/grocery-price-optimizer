import {
  formatUnitPrice,
  parsePackageSize,
  type ParsedPackageSize,
} from "./packageSize";
import { groceryWordTokens, stemGroceryToken } from "./productSearchQuery";

export type PricedOffer = {
  name: string;
  price: number;
  storeName: string;
  size?: string;
};

/**
 * Matching rule
 * -------------
 * The searched item should be the product itself, not a flavor or ingredient
 * baked into a different food.
 *
 * A name is the product itself when its content words end with the query
 * ("Clover Honey", "Whole Milk", "Large Eggs"), or the only words after the
 * query are form / cut / diet words (breast, sliced, organic, roasted, …).
 * Container words at the very end (jar, bottle, bag, box) are ignored.
 *
 * It is a modifier when a different food follows the query ("Honey Nut
 * Cheerios", "Honey Roasted Peanuts", "chicken broth", "egg noodles",
 * "bread crumbs", "milk chocolate") or when flavored / flavor / style /
 * scented / infused follows the query. Modifier rows are used only when no
 * product-itself row matched the same keyword set.
 *
 * Tokens are whole words with a light plural stem, so "honey" does not match
 * "Honeycrisp" and "egg" does match "eggs".
 *
 * Price rule
 * ----------
 * Keyword strength still comes first (full name, then without a generic
 * trailing word such as Cereal, then the first two words). Inside the
 * strongest set:
 *
 * 1. If the list item names a size ("gallon of milk", "12 ct eggs"), pick the
 *    package closest to that size in the same dimension. Ties break on shelf
 *    price, because that is what the shopper pays for the package they asked
 *    for. A better unit price on the wrong size does not win.
 * 2. If the list item does not name a size, and both packages share a
 *    dimension (volume, weight, or count), pick the lower unit price. A half
 *    gallon must not beat a gallon just because the sticker is lower. Eggs
 *    and other counted items use price per each.
 * 3. Otherwise (no parseable size, or mixed dimensions) compare shelf price,
 *    then store name, then product name.
 */

export type MatchRole = "product" | "modifier" | "none";

const FORM = new Set(
  [
    "breast",
    "thigh",
    "wing",
    "drumstick",
    "tender",
    "tenderloin",
    "fillet",
    "filet",
    "steak",
    "chop",
    "roast",
    "ground",
    "patty",
    "strip",
    "loin",
    "rib",
    "leg",
    "quarter",
    "boneless",
    "skinless",
    "trimmed",
    "sliced",
    "shredded",
    "diced",
    "chopped",
    "minced",
    "crushed",
    "grated",
    "whole",
    "white",
    "wheat",
    "sourdough",
    "rye",
    "sandwich",
    "organic",
    "natural",
    "pure",
    "raw",
    "original",
    "plain",
    "regular",
    "classic",
    "fresh",
    "frozen",
    "dried",
    "canned",
    "unsalted",
    "salted",
    "sweet",
    "unsweetened",
    "creamy",
    "crunchy",
    "chunky",
    "smooth",
    "chunk",
    "spear",
    "floret",
    "stalk",
    "clove",
    "slice",
    "extra",
    "large",
    "medium",
    "small",
    "jumbo",
    "grade",
    "baby",
    "mini",
    "lowfat",
    "skim",
    "reduced",
    "fat",
    "free",
    "low",
    "sodium",
    "roasted",
    "glazed",
    "baked",
    "smoked",
    "grilled",
    "fried",
    "toasted",
    "whipped",
    "cultured",
    "seedless",
    "pitted",
  ].map((word) => stemGroceryToken(word))
);

const FLAVOR = new Set(
  ["flavored", "flavor", "flavour", "flavoured", "scented", "infused", "flavoring", "style"].map(
    (word) => stemGroceryToken(word)
  )
);

const PACKAGING = new Set(
  [
    "jar",
    "bottle",
    "jug",
    "carton",
    "bag",
    "box",
    "can",
    "pouch",
    "tub",
    "container",
    "package",
    "pkg",
    "roll",
    "stick",
    "tin",
    "canister",
  ].map((word) => stemGroceryToken(word))
);

const ROLE_RANK: Record<MatchRole, number> = {
  product: 0,
  modifier: 1,
  none: 2,
};

function contentTokens(text: string): string[] {
  return groceryWordTokens(text).map((token) => stemGroceryToken(token));
}

function stripTrailingPackaging(tokens: string[]): string[] {
  const copy = [...tokens];
  while (copy.length > 1 && PACKAGING.has(copy[copy.length - 1] ?? "")) {
    copy.pop();
  }
  return copy;
}

function containsAll(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const token of haystack) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  for (const token of needle) {
    const left = counts.get(token) ?? 0;
    if (left <= 0) {
      return false;
    }
    counts.set(token, left - 1);
  }
  return true;
}

function lastPhraseIndex(haystack: string[], needle: string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) {
    return -1;
  }
  let found = -1;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      found = index;
    }
  }
  return found;
}

export function matchRole(query: string, productName: string): MatchRole {
  const queryTokens = contentTokens(query);
  const productTokens = stripTrailingPackaging(contentTokens(productName));
  if (queryTokens.length === 0 || !containsAll(productTokens, queryTokens)) {
    return "none";
  }

  const index = lastPhraseIndex(productTokens, queryTokens);
  if (index < 0) {
    return "modifier";
  }

  const after = productTokens.slice(index + queryTokens.length);
  if (after.length === 0) {
    return "product";
  }
  if (after.some((token) => FLAVOR.has(token))) {
    return "modifier";
  }
  if (after.every((token) => FORM.has(token))) {
    return "product";
  }
  return "modifier";
}

export function packageSizeOf(
  name: string,
  size?: string
): ParsedPackageSize | null {
  if (size?.trim()) {
    const fromField = parsePackageSize(size);
    if (fromField) {
      return fromField;
    }
  }
  return parsePackageSize(name);
}

export function unitPriceForProduct(
  price: number,
  name: string,
  size?: string
): { unitPrice: number; unitPriceText: string } | null {
  const parsed = packageSizeOf(name, size);
  if (!parsed) {
    return null;
  }
  return formatUnitPrice(price, parsed);
}

function sizeDistance(
  requested: ParsedPackageSize,
  actual: ParsedPackageSize | null
): number {
  if (!actual || actual.dimension !== requested.dimension || requested.amount <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(actual.amount - requested.amount) / requested.amount;
}

function compareShelf(a: PricedOffer, b: PricedOffer): number {
  if (a.price !== b.price) {
    return a.price - b.price;
  }
  const storeCmp = a.storeName.localeCompare(b.storeName);
  if (storeCmp !== 0) {
    return storeCmp;
  }
  return a.name.localeCompare(b.name);
}

/**
 * Orders two catalog rows for one grocery line. Lower is the better offer.
 * See the matching and price rules at the top of this file.
 */
export function compareProductOffers(
  query: string,
  a: PricedOffer,
  b: PricedOffer
): number {
  const roleCmp = ROLE_RANK[matchRole(query, a.name)] - ROLE_RANK[matchRole(query, b.name)];
  if (roleCmp !== 0) {
    return roleCmp;
  }

  const requested = parsePackageSize(query);
  const sizeA = packageSizeOf(a.name, a.size);
  const sizeB = packageSizeOf(b.name, b.size);

  if (requested) {
    const distA = sizeDistance(requested, sizeA);
    const distB = sizeDistance(requested, sizeB);
    if (Number.isFinite(distA) || Number.isFinite(distB)) {
      if (distA !== distB) {
        return distA - distB;
      }
      return compareShelf(a, b);
    }
  }

  if (
    sizeA &&
    sizeB &&
    sizeA.dimension === sizeB.dimension &&
    sizeA.amount > 0 &&
    sizeB.amount > 0
  ) {
    const diff = a.price / sizeA.amount - b.price / sizeB.amount;
    if (Math.abs(diff) > 1e-9) {
      return diff;
    }
  }

  return compareShelf(a, b);
}
