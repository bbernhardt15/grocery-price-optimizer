/**
 * Match parsed lines to catalog families. A named brand or size stays
 * the pick. A brand we do not carry is not silently swapped.
 */

import { groupBrowseFamilies, type BrowseTile } from "../catalog/family";
import type { BrowseProduct } from "../catalog/types";
import { parsePackageSize } from "../packageSize";
import { groceryWordTokens, stemGroceryToken } from "../productSearchQuery";
import type { ParsedImportItem } from "./parseImportText";

export type ImportStatus = "matched" | "ambiguous" | "missing";

export type ImportReviewItem = {
  key: string;
  raw: string;
  name: string;
  quantity: number;
  brand?: string;
  size?: string;
  upc?: string;
  notes?: string;
  status: ImportStatus;
  /** Shown when the requested brand is not on the shelf. */
  shelfNote?: string;
  accepted: boolean;
  selectedId: string | null;
  choices: Array<{ score: number; product: BrowseTile }>;
};

export type ImportMatchResult = {
  total: number;
  found: number;
  items: ImportReviewItem[];
};

const CUTS = new Set(
  ["thigh", "breast", "wing", "drumstick", "tender", "tenderloin", "rib", "roast", "ground", "fillet", "filet", "chop"].map(
    (word) => stemGroceryToken(word)
  )
);

const IGNORE = new Set(["good", "great", "nice", "favorite", "favourite", "best", "cheap", "yummy"]);

const CONFLICTS = [
  ["ice", "cream"],
  ["cereal"],
  ["juice"],
  ["yogurt"],
  ["noodle"],
];

function stems(text: string): string[] {
  return groceryWordTokens(text)
    .map((token) => stemGroceryToken(token))
    .filter((token) => token.length > 1 && !IGNORE.has(token));
}

/** A shelf neighbor that shares one word but is a different food. */
function kindClash(query: string[], hay: Set<string>): number {
  const pairs: Array<[string, string]> = [
    ["tortilla", "chip"],
    ["butter", "peanut"],
    ["beef", "dog"],
    ["chocolate", "cookie"],
  ];
  let penalty = 0;
  for (const [wanted, extra] of pairs) {
    const hasWanted = query.includes(wanted);
    const hasExtra = query.includes(extra);
    if (hay.has(wanted) && hay.has(extra) && hasWanted && !hasExtra) penalty += 0.55;
    if (hay.has(extra) && !hay.has(wanted) && hasWanted && !hasExtra && extra === "dog") penalty += 0.35;
  }
  return penalty;
}

function hayHas(hay: Set<string>, token: string): boolean {
  if (hay.has(token)) return true;
  if ((token === "coke" || token === "cola") && (hay.has("coke") || hay.has("cola"))) return true;
  return false;
}

function brandHit(brand: string | undefined, variant: BrowseProduct): boolean {
  const needles = stems(brand || "").filter((token) => token.length >= 3);
  if (!needles.length) return false;
  const hay = new Set(stems(`${variant.brand} ${variant.name}`));
  return needles.every((token) => hay.has(token));
}

function sizeDistance(wantedText: string | undefined, product: BrowseProduct): number {
  const wanted = parsePackageSize(wantedText);
  const have = product.packageSize;
  if (!wanted || !have) return 0.45;
  if (wanted.dimension !== have.dimension) return 1;
  if (wanted.amount <= 0 || have.amount <= 0) return 0.45;
  const ratio = wanted.amount / have.amount;
  return Math.min(1, Math.abs(Math.log(ratio)) / Math.log(4));
}

function scoreVariant(item: ParsedImportItem, variant: BrowseProduct): number {
  if (item.upc && variant.upc && item.upc === variant.upc) return 3;
  const query = stems([item.name, item.brand].filter(Boolean).join(" "));
  if (!query.length) return 0;
  const hayTokens = stems(`${variant.name} ${variant.brand}`);
  const hay = new Set(hayTokens);
  let hits = 0;
  for (const token of query) if (hayHas(hay, token)) hits += 1;
  let score = hits / query.length;

  const queryCuts = query.filter((token) => CUTS.has(token));
  const productCuts = hayTokens.filter((token) => CUTS.has(token));
  if (queryCuts.length && productCuts.length && !queryCuts.every((token) => productCuts.includes(token))) {
    score -= 0.6;
  }

  for (const group of CONFLICTS) {
    const inProduct = group.every((token) => hay.has(stemGroceryToken(token)));
    const inQuery = group.some((token) => query.includes(stemGroceryToken(token)));
    if (inProduct && !inQuery) score -= 0.45;
  }

  score -= kindClash(query, hay);

  if (item.brand) score += brandHit(item.brand, variant) ? 0.4 : -0.2;
  const wanted = item.size || (parsePackageSize(item.name) ? item.name : undefined);
  score += (1 - sizeDistance(wanted, variant)) * 0.18;
  return score;
}

function closestVariant(item: ParsedImportItem, tile: BrowseTile): BrowseProduct {
  const wanted = item.size || undefined;
  const ranked = [...tile.variants].sort((a, b) => {
    const brandDelta = Number(brandHit(item.brand, b)) - Number(brandHit(item.brand, a));
    if (brandDelta) return brandDelta;
    const sizeDelta = sizeDistance(wanted, a) - sizeDistance(wanted, b);
    if (Math.abs(sizeDelta) > 0.01) return sizeDelta;
    return scoreVariant(item, b) - scoreVariant(item, a);
  });
  return ranked[0] ?? tile;
}

function variantLabelOf(variant: BrowseProduct & { label?: string; variantLabel?: string; sizeLabel?: string }): string {
  return variant.variantLabel || variant.label || variant.sizeLabel || "";
}

function withSelection(tile: BrowseTile, variantId: string): BrowseTile {
  const selected = tile.variants.find((variant) => variant.id === variantId) ?? tile.variants[0] ?? tile;
  return {
    ...tile,
    ...selected,
    id: selected.id,
    name: tile.familyName || tile.name,
    catalogName: selected.name,
    familyKey: tile.familyKey,
    familyName: tile.familyName,
    defaultVariantId: selected.id,
    variantLabel: variantLabelOf(selected),
    sizeLabel: selected.sizeLabel || variantLabelOf(selected),
    variants: tile.variants,
    flavors: tile.flavors,
  };
}

export function matchImportItems(items: ParsedImportItem[], products: BrowseProduct[]): ImportMatchResult {
  const families = groupBrowseFamilies(products);
  const review: ImportReviewItem[] = items.slice(0, 80).map((item, index) => {
    const ranked = families
      .map((tile) => {
        let best = -Infinity;
        for (const variant of tile.variants) best = Math.max(best, scoreVariant(item, variant));
        return { tile, score: best };
      })
      .filter((row) => row.score > 0.2)
      .sort((a, b) => b.score - a.score);

    const branded = item.brand ? ranked.filter((row) => row.tile.variants.some((variant) => brandHit(item.brand, variant))) : [];
    const pool = branded.length ? branded : ranked;
    const best = pool[0];
    const close = best ? pool.filter((row) => best.score - row.score <= 0.12).slice(0, 3) : [];
    const brandMiss = Boolean(item.brand) && branded.length === 0 && ranked.length > 0;

    let status: ImportStatus = "missing";
    if (best && best.score >= 0.72 && close.length === 1 && !brandMiss) status = "matched";
    else if (best && best.score >= 0.62) status = "ambiguous";
    else status = "missing";

    const shown = status === "missing" ? [] : close;
    const choices = shown.map((row) => {
      const variant = closestVariant(item, row.tile);
      return { score: Math.round(row.score * 100) / 100, product: withSelection(row.tile, variant.id) };
    });
    const selectedId = choices[0]?.product.id ?? null;
    return {
      key: `item-${index + 1}`,
      raw: item.raw,
      name: item.name,
      quantity: item.quantity,
      ...(item.brand ? { brand: item.brand } : {}),
      ...(item.size ? { size: item.size } : {}),
      ...(item.upc ? { upc: item.upc } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
      status,
      ...(brandMiss ? { shelfNote: `No ${item.brand} on the shelf. Pick one or skip.` } : {}),
      accepted: status !== "missing" && !brandMiss,
      selectedId,
      choices,
    };
  });

  const found = review.filter((item) => item.status !== "missing").length;
  return { total: review.length, found, items: review };
}
