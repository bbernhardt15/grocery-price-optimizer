import { upcKey } from "../catalog/normalize";

/** A catalog shelf price newer than this skips a live lookup. */
export const FRESH_CATALOG_MS = 24 * 60 * 60 * 1000;

export function catalogPriceIsFresh(
  updatedAt: Date | string | number | null | undefined,
  now = Date.now()
): boolean {
  const time =
    updatedAt instanceof Date
      ? updatedAt.getTime()
      : typeof updatedAt === "number"
        ? updatedAt
        : Date.parse(String(updatedAt ?? ""));
  return Number.isFinite(time) && now >= time && now - time <= FRESH_CATALOG_MS;
}

/** Cache identity for one store, ZIP, and UPC. */
export function priceCacheKey(storeName: string, zip: string, upc: string): string {
  return `${String(storeName || "").trim().toLowerCase()}|${String(zip || "").trim()}|${upcKey(upc) || ""}`;
}
