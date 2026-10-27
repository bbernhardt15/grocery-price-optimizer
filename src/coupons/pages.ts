import { readFileSync } from "node:fs";
import path from "node:path";
import { mappingForStore } from "../pricing/flipp/merchants";

export type CouponPageKind = "coupons" | "deals" | "weekly" | "home";

export type CouponPage = {
  storeName: string;
  url: string;
  label: string;
  note: string;
  kind: CouponPageKind;
  aliases: string[];
};

const KINDS = new Set<CouponPageKind>(["coupons", "deals", "weekly", "home"]);

function pagesFile(): string {
  const nextToModule = path.join(__dirname, "pages.json");
  try {
    readFileSync(nextToModule, "utf8");
    return nextToModule;
  } catch {
    return path.join(process.cwd(), "src/coupons/pages.json");
  }
}

export function normalizeStoreKey(storeName: string): string {
  return String(storeName || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function loadPages(): CouponPage[] {
  const parsed = JSON.parse(readFileSync(pagesFile(), "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Coupon pages must be a non-empty JSON array");
  }
  const seen = new Set<string>();
  return parsed.map((entry, index) => {
    const row = entry as Partial<CouponPage>;
    const storeName = row.storeName?.trim() ?? "";
    const url = row.url?.trim() ?? "";
    const label = row.label?.trim() ?? "";
    const note = row.note?.trim() ?? "";
    if (!storeName || !url || !label || !note || !row.kind || !KINDS.has(row.kind)) {
      throw new Error(`Coupon page row ${index} is missing a store, url, label, note, or kind`);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`Coupon page for ${storeName} must be an https URL`);
    }
    if (parsedUrl.protocol !== "https:") {
      throw new Error(`Coupon page for ${storeName} must be https`);
    }
    const key = normalizeStoreKey(storeName);
    if (seen.has(key)) throw new Error(`Coupon pages list ${storeName} more than once`);
    seen.add(key);
    const aliases = Array.isArray(row.aliases) ? row.aliases.map((alias) => normalizeStoreKey(String(alias))).filter(Boolean) : [];
    if (!aliases.includes(key)) aliases.unshift(key);
    return { storeName, url, label, note, kind: row.kind, aliases };
  });
}

export const COUPON_PAGES: CouponPage[] = loadPages();

export function couponPageFor(storeName: string): CouponPage | undefined {
  const key = normalizeStoreKey(storeName);
  if (!key) return undefined;
  return COUPON_PAGES.find((page) => page.aliases.includes(key));
}

/**
 * Link for the trip card. A Flipp banner's couponUrl wins when it is set,
 * so merchants.json stays the banner list. The label and note still come
 * from the coupon page table. Unknown stores get no link.
 */
export type StoreCouponLink = {
  storeName: string;
  url: string;
  label: string;
  note: string;
  kind: CouponPageKind;
};

export function publicCouponLink(storeName: string): StoreCouponLink | undefined {
  const page = couponLinkFor(storeName);
  if (!page) return undefined;
  return {
    storeName: page.storeName,
    url: page.url,
    label: page.label,
    note: page.note,
    kind: page.kind,
  };
}

export function couponLinkFor(storeName: string): CouponPage | undefined {
  const page = couponPageFor(storeName);
  const fromBanner = mappingForStore(storeName)?.couponUrl?.trim();
  if (!page && !fromBanner) return undefined;
  if (!page) {
    return {
      storeName: storeName.trim(),
      url: fromBanner as string,
      label: `${storeName.trim()} coupons`,
      note: `Opens ${storeName.trim()}. Clip coupons on the store’s own site. Grocery Gitter cannot clip them for you.`,
      kind: "coupons",
      aliases: [normalizeStoreKey(storeName)],
    };
  }
  if (!fromBanner || fromBanner === page.url) return page;
  return { ...page, url: fromBanner };
}
