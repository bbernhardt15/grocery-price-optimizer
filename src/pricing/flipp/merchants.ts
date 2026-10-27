/**
 * Map Flipp flyer merchants onto Grocery Gitter `storeName` values.
 * The banner list lives in `merchants.json` (loaded at startup). Weekly ads
 * are not a shelf catalog. `dealsOnly` banners enter the trip only when a
 * circular item wins — demo seed rows are not used as a shelf price.
 *
 * Ids in that file were checked against Flipp's flyer index for ZIPs
 * 45103, 10001, 60601, 75201, 90012, 30303, 33101, and 77002 on 2026-10-23.
 * See `sample-zips.json`. Banners that did not come back (Safeway, Shaw's,
 * Food Lion, Giant, Giant Eagle, Hy-Vee, Wegmans, ShopRite, Harris Teeter
 * as its own circular) are not listed. Harris Teeter stays a Kroger name
 * alias because the live Kroger API covers that banner; Flipp did not
 * return a separate Harris Teeter flyer for those ZIPs.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type FlippMerchantMapping = {
  /** Grocery Gitter storeName. */
  storeName: string;
  /** Known Flipp merchant_id values (US). */
  merchantIds: number[];
  /** Lowercase Flipp `merchant_name` aliases. */
  nameAliases: string[];
  /** Token used in Flipp consumer search (`ALDI AND milk`). */
  searchName: string;
  /**
   * FlyerKit `merchant_identifier` slug. Only used with
   * `FLIPP_ACCESS_TOKEN` from a Flipp technical contact.
   */
  flyerKitSlug: string;
  /** When true, name aliases must match exactly (no prefix). */
  exactName?: boolean;
  /**
   * Trip and browse prices come only from the circular. No demo-catalog
   * fallback, and no cart handoff.
   */
  dealsOnly?: boolean;
  /**
   * Public storefront link. `{q}` is the encoded search term. A URL with no
   * `{q}` is the store homepage, used when a search URL could not be verified.
   * Not a cart fill.
   */
  searchUrl?: string;
  /**
   * The store's own coupon, rewards, or weekly-ad page. Not a scrape and not
   * a cart fill. Shoppers clip coupons on that page.
   */
  couponUrl?: string;
  /** Club pricing. Membership may be required. No third-party cart write. */
  club?: boolean;
};

type MerchantConfigRow = {
  storeName?: string;
  merchantIds?: number[];
  nameAliases?: string[];
  searchName?: string;
  flyerKitSlug?: string;
  exactName?: boolean;
  dealsOnly?: boolean;
  searchUrl?: string;
  couponUrl?: string;
  club?: boolean;
};

function merchantsFile(): string {
  const nextToModule = path.join(__dirname, "merchants.json");
  if (existsSync(nextToModule)) {
    return nextToModule;
  }
  const fromSource = path.join(process.cwd(), "src/pricing/flipp/merchants.json");
  if (existsSync(fromSource)) {
    return fromSource;
  }
  throw new Error(`Flipp merchant config not found at ${nextToModule}`);
}

function loadMerchantConfig(): FlippMerchantMapping[] {
  const parsed = JSON.parse(readFileSync(merchantsFile(), "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Flipp merchant config must be a non-empty JSON array");
  }

  const seen = new Set<string>();
  return parsed.map((entry, index) => {
    const row = entry as MerchantConfigRow;
    const storeName = row.storeName?.trim() ?? "";
    const searchName = row.searchName?.trim() ?? "";
    const flyerKitSlug = row.flyerKitSlug?.trim() ?? "";
    if (!storeName || !searchName || !flyerKitSlug) {
      throw new Error(
        `Flipp merchant config row ${index} is missing storeName, searchName, or flyerKitSlug`
      );
    }
    const key = storeName.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Flipp merchant config lists ${storeName} more than once`);
    }
    seen.add(key);
    if (
      !Array.isArray(row.merchantIds) ||
      row.merchantIds.length === 0 ||
      row.merchantIds.some((id) => !Number.isInteger(id))
    ) {
      throw new Error(`Flipp merchant config row ${storeName} has invalid merchantIds`);
    }
    if (!Array.isArray(row.nameAliases) || row.nameAliases.length === 0) {
      throw new Error(`Flipp merchant config row ${storeName} needs nameAliases`);
    }
    if (row.searchUrl !== undefined) {
      const probe = row.searchUrl.replaceAll("{q}", "milk");
      let parsed: URL;
      try {
        parsed = new URL(probe);
      } catch {
        throw new Error(`Flipp merchant config row ${storeName} searchUrl must be an https URL`);
      }
      if (parsed.protocol !== "https:") {
        throw new Error(`Flipp merchant config row ${storeName} searchUrl must be https`);
      }
    }
    if (!row.couponUrl?.trim()) {
      throw new Error(`Flipp merchant config row ${storeName} needs a couponUrl`);
    }
    let couponUrl: URL;
    try {
      couponUrl = new URL(row.couponUrl);
    } catch {
      throw new Error(`Flipp merchant config row ${storeName} couponUrl must be an https URL`);
    }
    if (couponUrl.protocol !== "https:" || couponUrl.href.includes("{q}")) {
      throw new Error(`Flipp merchant config row ${storeName} couponUrl must be an https page, not a search template`);
    }
    return {
      storeName,
      merchantIds: row.merchantIds,
      nameAliases: row.nameAliases,
      searchName,
      flyerKitSlug,
      ...(row.exactName ? { exactName: true } : {}),
      ...(row.dealsOnly ? { dealsOnly: true } : {}),
      ...(row.searchUrl ? { searchUrl: row.searchUrl } : {}),
      couponUrl: couponUrl.href,
      ...(row.club ? { club: true } : {}),
    };
  });
}

export const FLIPP_MERCHANT_MAPPINGS: FlippMerchantMapping[] = loadMerchantConfig();

export function normalizeMerchantName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ");
}

function aliasMatches(
  merchantName: string,
  alias: string,
  exactName: boolean | undefined
): boolean {
  const name = normalizeMerchantName(merchantName);
  const key = normalizeMerchantName(alias);
  if (name === key) {
    return true;
  }
  if (exactName) {
    return false;
  }
  return name.startsWith(`${key} `);
}

export function mappingForStore(
  storeName: string
): FlippMerchantMapping | undefined {
  const key = normalizeMerchantName(storeName);
  return FLIPP_MERCHANT_MAPPINGS.find(
    (mapping) =>
      normalizeMerchantName(mapping.storeName) === key ||
      mapping.nameAliases.some((alias) => aliasMatches(storeName, alias, mapping.exactName))
  );
}

/**
 * Deal-only banners must not fall back to the demo catalog. A missing
 * circular stays Unavailable instead of looking like a shelf price.
 */
export function allowsDemoFallback(storeName: string): boolean {
  return mappingForStore(storeName)?.dealsOnly !== true;
}

export function canonicalGroceryStoreName(storeName: string): string {
  return mappingForStore(storeName)?.storeName ?? storeName.trim();
}

export function groceryStoreNameForFlippMerchant(
  merchantName: string,
  merchantId?: number | null
): string | undefined {
  const id = typeof merchantId === "number" ? merchantId : undefined;
  for (const mapping of FLIPP_MERCHANT_MAPPINGS) {
    if (id != null && mapping.merchantIds.includes(id)) {
      return mapping.storeName;
    }
  }
  for (const mapping of FLIPP_MERCHANT_MAPPINGS) {
    if (
      mapping.nameAliases.some((alias) =>
        aliasMatches(merchantName, alias, mapping.exactName)
      )
    ) {
      return mapping.storeName;
    }
  }
  return undefined;
}

export function flippItemMatchesStore(
  storeName: string,
  merchantName: string,
  merchantId?: number | null
): boolean {
  const mapping = mappingForStore(storeName);
  if (!mapping) {
    return false;
  }
  const mapped = groceryStoreNameForFlippMerchant(merchantName, merchantId);
  return mapped === mapping.storeName;
}
