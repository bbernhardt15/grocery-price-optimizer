import type { SizeDimension } from "../packageSize";
import { groceryWordTokens, stemGroceryToken } from "../productSearchQuery";
import { upcKey } from "./normalize";
import type { BrowseProduct, CatalogGap, CatalogOffer } from "./types";

export const MIN_SUBSTITUTE_SCORE = 0.5;

export type SubstituteProfile = {
  upc?: string;
  name: string;
  brand: string;
  departmentId: string;
  storeBrand?: boolean;
  packageSize?: { dimension: SizeDimension; amount: number } | null;
};

const FILLER = new Set([
  "fresh",
  "premium",
  "original",
  "classic",
  "natural",
  "selected",
  "specially",
  "value",
  "great",
  "good",
  "gather",
  "friendly",
  "farms",
  "simple",
  "truth",
]);

function tokensOf(name: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of groceryWordTokens(name)) {
    const stem = stemGroceryToken(raw.toLowerCase());
    if (!stem || FILLER.has(stem) || seen.has(stem)) {
      continue;
    }
    seen.add(stem);
    tokens.push(stem);
  }
  return tokens;
}

function dice(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const rightSet = new Set(right);
  let shared = 0;
  for (const token of left) {
    if (rightSet.has(token)) {
      shared += 1;
    }
  }
  return (2 * shared) / (left.length + right.length);
}

function isSubset(smaller: string[], larger: string[]): boolean {
  if (smaller.length === 0 || smaller.length > larger.length) {
    return false;
  }
  const set = new Set(larger);
  return smaller.every((token) => set.has(token));
}

function sizeScore(
  left: SubstituteProfile["packageSize"],
  right: SubstituteProfile["packageSize"]
): number {
  if (!left || !right) {
    return 0.35;
  }
  if (left.dimension !== right.dimension || left.amount <= 0 || right.amount <= 0) {
    return 0.05;
  }
  const diff = Math.abs(left.amount - right.amount) / Math.max(left.amount, right.amount);
  return 1 - Math.min(1, diff);
}

function brandScore(target: SubstituteProfile, candidate: SubstituteProfile): number {
  const left = target.brand.trim().toLowerCase();
  const right = candidate.brand.trim().toLowerCase();
  if (left && left === right) {
    return 1;
  }
  if (candidate.storeBrand) {
    return 0.55;
  }
  return 0.35;
}

/**
 * Score a candidate substitute. Returns null when it is not a real alternative:
 * different department, same UPC, or the names do not share a strong token overlap.
 * Brand is only a tiebreaker. Store brands stay eligible.
 */
export function scoreSubstitute(
  target: SubstituteProfile,
  candidate: SubstituteProfile
): number | null {
  if (!target.departmentId || target.departmentId !== candidate.departmentId) {
    return null;
  }
  if (target.departmentId === "other") {
    return null;
  }
  const targetUpc = upcKey(target.upc);
  const candidateUpc = upcKey(candidate.upc);
  if (targetUpc && candidateUpc && targetUpc === candidateUpc) {
    return null;
  }

  const left = tokensOf(target.name);
  const right = tokensOf(candidate.name);
  if (left.length === 0 || right.length === 0) {
    return null;
  }
  const overlap = dice(left, right);
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  const strong = overlap >= 0.5 || (shorter.length > 0 && isSubset(shorter, longer) && overlap >= 0.45);
  if (!strong) {
    return null;
  }

  const score =
    overlap * 0.62 +
    sizeScore(target.packageSize, candidate.packageSize) * 0.28 +
    brandScore(target, candidate) * 0.1;
  if (score < MIN_SUBSTITUTE_SCORE) {
    return null;
  }
  return Math.round(score * 1000) / 1000;
}

export function profileFromProduct(product: BrowseProduct): SubstituteProfile {
  return {
    upc: product.upc,
    name: product.name,
    brand: product.brand,
    departmentId: product.departmentId,
    storeBrand: product.storeBrand,
    packageSize: product.packageSize
      ? { dimension: product.packageSize.dimension, amount: product.packageSize.amount }
      : null,
  };
}

export type RankedSubstitute = {
  product: BrowseProduct;
  offer: CatalogOffer;
  score: number;
};

export function bestSubstituteAtStore(
  target: BrowseProduct,
  candidates: BrowseProduct[],
  storeName: string
): RankedSubstitute | null {
  const store = storeName.trim().toLowerCase();
  let best: RankedSubstitute | null = null;
  const targetProfile = profileFromProduct(target);
  for (const candidate of candidates) {
    if (candidate.id === target.id) {
      continue;
    }
    const offer = candidate.offers.find(
      (entry) =>
        entry.storeName.toLowerCase() === store && entry.availability !== "out_of_stock"
    );
    if (!offer) {
      continue;
    }
    const score = scoreSubstitute(targetProfile, profileFromProduct(candidate));
    if (score === null) {
      continue;
    }
    if (
      !best ||
      score > best.score ||
      (score === best.score && offer.price < best.offer.price)
    ) {
      best = { product: candidate, offer, score };
    }
  }
  return best;
}

export function gapsForProduct(
  target: BrowseProduct,
  candidates: BrowseProduct[],
  storeNames: string[]
): CatalogGap[] {
  const carried = new Set(target.offers.map((offer) => offer.storeName.toLowerCase()));
  const gaps: CatalogGap[] = [];
  for (const storeName of storeNames) {
    if (carried.has(storeName.trim().toLowerCase())) {
      continue;
    }
    const best = bestSubstituteAtStore(target, candidates, storeName);
    gaps.push({
      storeName,
      substitute: best
        ? {
            productId: best.product.id,
            name: best.product.name,
            brand: best.product.brand,
            price: best.offer.price,
            ...(best.offer.unitPriceText ? { unitPriceText: best.offer.unitPriceText } : {}),
            ...(best.product.sizeLabel ? { sizeLabel: best.product.sizeLabel } : {}),
            ...(best.product.imageUrls[0] ? { imageUrl: best.product.imageUrls[0] } : {}),
            score: best.score,
            storeBrand: best.product.storeBrand,
          }
        : null,
    });
  }
  return gaps;
}
