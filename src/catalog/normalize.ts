import { formatUnitPrice, parsePackageSize } from "../packageSize";
import { departmentById, mapToDepartment } from "./departments";
import type {
  BrowseProduct,
  CatalogOffer,
  OfferAvailability,
  OfferPriceSource,
  PackageSizeSummary,
  RawCatalogRecord,
} from "./types";

const STORE_BRANDS = new Set(
  [
    "kroger",
    "simple truth",
    "private selection",
    "great value",
    "marketside",
    "equate",
    "parent's choice",
    "good & gather",
    "up & up",
    "favorite day",
    "friendly farms",
    "kirkwood",
    "l'oven fresh",
    "goldhen",
    "earthly grains",
    "reggano",
    "countryside creamery",
    "millville",
    "clancy's",
    "specially selected",
    "aldi",
  ].map((brand) => brand.toLowerCase())
);

const SOURCE_RANK: Record<OfferPriceSource, number> = {
  live: 4,
  partner_feed: 3,
  weekly_ad: 2,
  seed: 1,
};

export function isStoreBrand(brand: string | undefined): boolean {
  const key = brand?.trim().toLowerCase() ?? "";
  return key.length > 0 && STORE_BRANDS.has(key);
}

/**
 * GS1 check digit. Weights alternate 3, 1 from the right of the body
 * (the digits that sit to the left of the check digit).
 */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body[body.length - 1 - index]);
    sum += digit * (index % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

function hasGtinCheckDigit(digits: string): boolean {
  if (digits.length < 2) {
    return false;
  }
  return gtinCheckDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}

/**
 * Digits-only key shared by Walmart and Kroger.
 *
 * Walmart UPC-A is 12 digits and includes the check digit. EAN-13 and GTIN-14
 * of that same code also include it. Kroger's product code is 13 digits and
 * does not: it is the UPC body padded with leading zeros, and the last digit
 * fails the GTIN check. A valid check digit is dropped, then leading zeros
 * are stripped, so both forms land on the same key. Too-short codes are ignored.
 */
export function upcKey(upc: string | undefined | null): string | null {
  if (!upc) {
    return null;
  }
  let digits = upc.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14) {
    return null;
  }
  if ((digits.length === 8 || digits.length === 12 || digits.length === 13 || digits.length === 14) && hasGtinCheckDigit(digits)) {
    digits = digits.slice(0, -1);
  }
  const stripped = digits.replace(/^0+/, "");
  return stripped.length > 0 ? stripped : null;
}

function availabilityOf(value: OfferAvailability | undefined): OfferAvailability {
  return value ?? "unknown";
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function uniqueImages(urls: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const images: string[] = [];
  for (const url of urls) {
    const trimmed = url?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    images.push(trimmed);
    if (images.length >= 4) {
      break;
    }
  }
  return images;
}

export function offerFromRecord(record: RawCatalogRecord): {
  offer: CatalogOffer;
  departmentId: string;
  subcategory?: string;
  packageSize?: PackageSizeSummary;
  storeBrand: boolean;
  imageUrls: string[];
} | null {
  const name = record.name.trim();
  const brand = record.brand.trim() || record.storeName.trim();
  const storeName = record.storeName.trim();
  if (!name || !storeName || !Number.isFinite(record.price) || record.price < 0) {
    return null;
  }

  const mapped = mapToDepartment(record.categories, name, {
    departmentId: record.departmentId,
    subcategory: record.subcategory,
  });
  const parsed = parsePackageSize(record.size) ?? parsePackageSize(name);
  const packageSize = parsed
    ? { dimension: parsed.dimension, amount: parsed.amount, label: parsed.label }
    : undefined;
  const unit = packageSize ? formatUnitPrice(record.price, packageSize) : null;
  const sizeLabel = record.size?.trim() || packageSize?.label;
  const upc = upcKey(record.upc) ? record.upc?.replace(/\D/g, "") : undefined;
  const productId = record.productId?.trim() || record.retailerItemId?.trim() || undefined;

  const offer: CatalogOffer = {
    storeName,
    price: Math.round(record.price * 100) / 100,
    onSale: Boolean(record.onSale),
    availability: availabilityOf(record.availability),
    priceSource: record.priceSource,
    ...(unit ?? {}),
    ...(sizeLabel ? { sizeLabel } : {}),
    ...(productId ? { productId, retailerItemId: record.retailerItemId?.trim() || productId } : {}),
    ...(upc ? { upc } : {}),
    ...(record.locationId?.trim() ? { locationId: record.locationId.trim() } : {}),
  };

  return {
    offer,
    departmentId: mapped.departmentId,
    subcategory: mapped.subcategory,
    packageSize,
    storeBrand: record.storeBrand ?? isStoreBrand(brand),
    imageUrls: uniqueImages(record.imageUrls ?? []),
  };
}

type GroupBucket = {
  id: string;
  upc?: string;
  names: Map<string, number>;
  brands: Map<string, number>;
  departments: Map<string, number>;
  subcategories: Map<string, number>;
  images: string[];
  sizeLabel?: string;
  packageSize?: PackageSizeSummary;
  storeBrandVotes: number;
  brandVotes: number;
  offers: CatalogOffer[];
};

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function winner(map: Map<string, number>, preferLonger = false): string {
  let best = "";
  let bestCount = -1;
  for (const [key, count] of map) {
    if (
      count > bestCount ||
      (count === bestCount && preferLonger && key.length > best.length) ||
      (count === bestCount && !preferLonger && key.localeCompare(best) < 0)
    ) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function pickBestOffer(offers: CatalogOffer[]): CatalogOffer {
  const purchasable = offers.filter((offer) => offer.availability !== "out_of_stock");
  const pool = purchasable.length > 0 ? purchasable : offers;
  return [...pool].sort((a, b) => a.price - b.price || a.storeName.localeCompare(b.storeName))[0];
}

function dedupeOffers(offers: CatalogOffer[]): CatalogOffer[] {
  const byStore = new Map<string, CatalogOffer>();
  for (const offer of offers) {
    const key = offer.storeName.toLowerCase();
    const existing = byStore.get(key);
    if (!existing) {
      byStore.set(key, offer);
      continue;
    }
    const rank = SOURCE_RANK[offer.priceSource] - SOURCE_RANK[existing.priceSource];
    if (rank > 0 || (rank === 0 && offer.price < existing.price)) {
      byStore.set(key, offer);
    }
  }
  return [...byStore.values()].sort((a, b) => a.price - b.price || a.storeName.localeCompare(b.storeName));
}

/**
 * Group store offers that share a UPC into one product. Offers with no usable
 * UPC stay as their own card so a missing code never glues two foods together.
 * When the same store sends both a demo row and a live row, the live price wins.
 */
export function groupOffersByUpc(records: RawCatalogRecord[]): BrowseProduct[] {
  const groups = new Map<string, GroupBucket>();

  for (const record of records) {
    const built = offerFromRecord(record);
    if (!built) {
      continue;
    }
    const key = upcKey(record.upc);
    const id = key
      ? `upc:${key}`
      : `local:${slug(record.storeName)}:${slug(record.brand)}:${slug(record.name)}:${slug(built.offer.sizeLabel ?? "")}`;
    let bucket = groups.get(id);
    if (!bucket) {
      bucket = {
        id,
        ...(key ? { upc: record.upc?.replace(/\D/g, "") } : {}),
        names: new Map(),
        brands: new Map(),
        departments: new Map(),
        subcategories: new Map(),
        images: [],
        storeBrandVotes: 0,
        brandVotes: 0,
        offers: [],
      };
      groups.set(id, bucket);
    }
    bump(bucket.names, record.name.trim());
    bump(bucket.brands, (record.brand.trim() || record.storeName.trim()));
    bump(bucket.departments, built.departmentId);
    if (built.subcategory) {
      bump(bucket.subcategories, built.subcategory);
    }
    bucket.brandVotes += 1;
    if (built.storeBrand) {
      bucket.storeBrandVotes += 1;
    }
    bucket.images = uniqueImages([...bucket.images, ...built.imageUrls]);
    if (!bucket.packageSize && built.packageSize) {
      bucket.packageSize = built.packageSize;
      bucket.sizeLabel = built.offer.sizeLabel;
    }
    bucket.offers.push(built.offer);
  }

  const products: BrowseProduct[] = [];
  for (const bucket of groups.values()) {
    const offers = dedupeOffers(bucket.offers);
    const bestOffer = pickBestOffer(offers);
    if (!bestOffer) {
      continue;
    }
    const departmentId = winner(bucket.departments);
    const department = departmentById(departmentId);
    const name = winner(bucket.names, true);
    const brand = winner(bucket.brands);
    products.push({
      id: bucket.id,
      ...(bucket.upc ? { upc: bucket.upc } : {}),
      name,
      brand,
      imageUrls: bucket.images,
      departmentId,
      departmentName: department?.name ?? "Other",
      ...(winner(bucket.subcategories) ? { subcategory: winner(bucket.subcategories) } : {}),
      ...(bucket.sizeLabel ? { sizeLabel: bucket.sizeLabel } : {}),
      ...(bucket.packageSize ? { packageSize: bucket.packageSize } : {}),
      storeBrand: bucket.storeBrandVotes > 0 && bucket.storeBrandVotes === bucket.brandVotes,
      offers,
      bestOffer,
    });
  }

  return products.sort((a, b) => a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand) || a.id.localeCompare(b.id));
}
