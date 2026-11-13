import type { BrowseProduct, CatalogOffer, StoreCoverage } from "./types";

/**
 * Shopper-facing catalog results are Kroger-family banners and Walmart.
 * Other chains (Publix, Target, Aldi, and the rest) stay out of search,
 * browse, suggest, change, and match.
 */
const KROGER_BANNERS = [
  "kroger",
  "ralphs",
  "fred meyer",
  "frys",
  "fry s",
  "king soopers",
  "smiths",
  "smith s",
  "harris teeter",
  "marianos",
  "mariano s",
  "pick n save",
  "metro market",
  "qfc",
  "dillons",
  "dillon s",
  "bakers",
  "baker s",
  "city market",
  "food 4 less",
  "foods co",
  "pay less",
  "gerbes",
  "jay c",
  "jayc",
  "owens",
  "owen s",
  "ruler",
  "ruler foods",
];

export function releaseStoreKey(name: unknown): string {
  return String(name || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isReleaseStore(name: unknown): boolean {
  const key = releaseStoreKey(name);
  if (!key) return false;
  if (key === "walmart" || key.startsWith("walmart ")) return true;
  return KROGER_BANNERS.some((banner) => key === banner || key.startsWith(`${banner} `));
}

export function releaseOffers<T extends { storeName?: string }>(offers: T[] | null | undefined): T[] {
  return (offers || []).filter((offer) => isReleaseStore(offer?.storeName));
}

function cheapest<T extends CatalogOffer>(offers: T[]): T {
  return [...offers].sort((a, b) => a.price - b.price || a.storeName.localeCompare(b.storeName))[0];
}

/** Drop offers from other chains. A product with none left is omitted. */
export function restrictReleaseProduct<T extends BrowseProduct>(product: T): T | null {
  const offers = releaseOffers(product.offers);
  if (!offers.length) return null;
  return { ...product, offers, bestOffer: cheapest(offers) };
}

export function restrictReleaseTile<T extends BrowseProduct & { variants?: BrowseProduct[]; defaultVariantId?: string }>(tile: T): T | null {
  const variants = (tile.variants || [])
    .map((variant) => restrictReleaseProduct(variant))
    .filter((variant): variant is BrowseProduct => Boolean(variant));
  const self = restrictReleaseProduct(tile);
  if (!self && !variants.length) return null;
  const base = self || ({ ...tile, offers: variants[0].offers, bestOffer: variants[0].bestOffer } as T);
  const defaultVariantId = variants.some((variant) => variant.id === tile.defaultVariantId)
    ? tile.defaultVariantId
    : variants[0]?.id || base.id;
  return { ...base, ...(variants.length ? { variants, defaultVariantId } : {}) };
}

export function restrictReleaseCoverage(rows: StoreCoverage[] | null | undefined): StoreCoverage[] {
  return (rows || []).filter((row) => isReleaseStore(row.storeName));
}

export function restrictReleaseBanners<T extends { storeName?: string }>(rows: T[] | null | undefined): T[] {
  return (rows || []).filter((row) => isReleaseStore(row.storeName));
}
