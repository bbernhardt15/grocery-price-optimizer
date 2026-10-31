import { formatUnitPrice, parsePackageSize } from "../packageSize";
import { publishSale } from "../pricing/saleFacts";
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
    "market pantry",
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

/** UPC-E, UPC-A, EAN-13, and GTIN-14 are the only lengths that carry a check digit. */
function hasStandardCheckDigit(digits: string): boolean {
  if (digits.length !== 8 && digits.length !== 12 && digits.length !== 13 && digits.length !== 14) {
    return false;
  }
  return hasGtinCheckDigit(digits);
}

/**
 * UPC-E (8 digits, or 7 when the number system 0 was dropped) expanded to
 * UPC-A. The check digit has to match the expanded code, so a plain EAN-8
 * stays an EAN-8.
 */
export function expandUpcE(upc: string | undefined | null): string | null {
  if (!upc) {
    return null;
  }
  const digits = upc.replace(/\D/g, "");
  if (digits.length === 8 && (digits[0] === "0" || digits[0] === "1")) {
    const expanded = upcAFromUpcE(digits[0], digits.slice(1, 7));
    return expanded?.endsWith(digits[7]) ? expanded : null;
  }
  if (digits.length === 7) {
    const expanded = upcAFromUpcE("0", digits.slice(0, 6));
    return expanded?.endsWith(digits[6]) ? expanded : null;
  }
  return null;
}

/** Number system + 6 UPC-E data digits → 12-digit UPC-A, including the check digit. */
function upcAFromUpcE(numberSystem: string, middle: string): string | null {
  if ((numberSystem !== "0" && numberSystem !== "1") || !/^\d{6}$/.test(middle)) {
    return null;
  }
  const digit = middle.split("");
  const last = digit[5];
  let body: string;
  if (last === "0" || last === "1" || last === "2") {
    body = `${numberSystem}${digit[0]}${digit[1]}${last}0000${digit[2]}${digit[3]}${digit[4]}`;
  } else if (last === "3") {
    body = `${numberSystem}${digit[0]}${digit[1]}${digit[2]}00000${digit[3]}${digit[4]}`;
  } else if (last === "4") {
    body = `${numberSystem}${digit[0]}${digit[1]}${digit[2]}${digit[3]}00000${digit[4]}`;
  } else {
    body = `${numberSystem}${digit[0]}${digit[1]}${digit[2]}${digit[3]}${digit[4]}0000${last}`;
  }
  if (body.length !== 11) {
    return null;
  }
  return `${body}${gtinCheckDigit(body)}`;
}

/**
 * Digits with a valid GS1 check digit removed.
 * A JSON number drops leading zeros (`049000042566` becomes `49000042566`).
 * When the shorter value is not itself a check-digit code, pad it back to
 * 12, 13, or 14 and keep the pad only if that form checks. A 13-digit
 * Kroger code is left alone: its last digit is not a check digit, and
 * padding it to 14 would risk dropping a real digit.
 */
function digitsWithoutCheck(upc: string | undefined | null): string | null {
  if (!upc) {
    return null;
  }
  let digits = upc.replace(/\D/g, "");
  const expanded = expandUpcE(digits);
  if (expanded) {
    digits = expanded;
  }
  if (digits.length < 8 || digits.length > 14) {
    return null;
  }
  if (!hasStandardCheckDigit(digits) && digits.length < 13) {
    const widths = digits.length <= 12 ? [12, 13, 14] : [13, 14];
    for (const width of widths) {
      if (digits.length >= width) {
        continue;
      }
      const padded = digits.padStart(width, "0");
      if (hasStandardCheckDigit(padded)) {
        digits = padded;
        break;
      }
    }
  }
  if (hasStandardCheckDigit(digits)) {
    digits = digits.slice(0, -1);
  }
  return digits;
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
  const digits = digitsWithoutCheck(upc);
  if (!digits) {
    return null;
  }
  const stripped = digits.replace(/^0+/, "");
  return stripped.length > 0 ? stripped : null;
}

/**
 * 13-digit Kroger `filter.productId`.
 * UPC-A is 12 digits and the last digit is the check digit. Drop it and
 * left-pad, even when that digit fails GS1: Walmart codes such as
 * `070708200500` are still sent as `0007070820050`. The same code with its
 * leading zero dropped (`70708200500`) takes that path too. A 13-digit Kroger
 * id is left intact when its last digit is not a check digit.
 */
export function krogerProductIdForLookup(upc: string | undefined | null): string | null {
  if (!upc) {
    return null;
  }
  let digits = upc.replace(/\D/g, "");
  const expanded = expandUpcE(digits);
  if (expanded) {
    digits = expanded;
  }
  if (digits.length < 8 || digits.length > 14) {
    return null;
  }
  // UPC-A is 12 digits including the check digit. An 11-digit code that does
  // not start with 0 is that same UPC with the leading zero dropped (JSON
  // numbers do this). Drop the check digit even when it fails GS1, matching
  // the 12-digit rule. An 11-digit code that starts with 0 is the UPC body
  // with no check digit, so it is only shortened when the padded form checks.
  if (digits.length === 12 || (digits.length === 11 && digits[0] !== "0")) {
    return digits.slice(0, -1).padStart(13, "0");
  }
  if ((digits.length === 8 || digits.length === 13 || digits.length === 14) && hasStandardCheckDigit(digits)) {
    digits = digits.slice(0, -1);
  } else if (digits.length < 12) {
    const padded = digits.padStart(12, "0");
    if (hasStandardCheckDigit(padded)) {
      return padded.slice(0, -1).padStart(13, "0");
    }
  }
  if (digits.length > 13 || digits.length < 8) {
    return null;
  }
  return digits.padStart(13, "0");
}

/**
 * Digits to store for a UPC. This is the same 13-digit Kroger id
 * {@link krogerProductIdForLookup} sends, so lookup and storage stay aligned.
 * The raw digits are kept when padding would change the shared UPC key or the
 * Walmart check-digit form.
 */
export function upcForStorage(upc: string | undefined | null): string | undefined {
  const digits = upc?.replace(/\D/g, "") ?? "";
  if (!digits || !upcKey(digits)) {
    return undefined;
  }
  const padded = krogerProductIdForLookup(digits);
  if (!padded || upcKey(padded) !== upcKey(digits)) {
    return digits;
  }
  const walmartBefore = walmartUpcForLookup(digits);
  const walmartAfter = walmartUpcForLookup(padded);
  if (walmartBefore && walmartAfter && walmartBefore !== walmartAfter) {
    return digits;
  }
  return padded;
}

/** 12-digit UPC-A with check digit, for Walmart Affiliate `GET /items?upc=`. */
export function walmartUpcForLookup(upc: string | undefined | null): string | null {
  const digits = digitsWithoutCheck(upc);
  if (!digits) {
    return null;
  }
  const body = digits.replace(/^0+/, "");
  if (body.length === 0 || body.length > 11) {
    return null;
  }
  const upcBody = body.padStart(11, "0");
  return `${upcBody}${gtinCheckDigit(upcBody)}`;
}

function pushCode(out: string[], code: string | null | undefined, pattern: RegExp): void {
  const digits = code?.replace(/\D/g, "") ?? "";
  if (!pattern.test(digits) || out.includes(digits)) {
    return;
  }
  out.push(digits);
}

/**
 * Codes to ask Walmart about, primary first.
 * UPC-E is expanded. The 12-digit UPC-A is then padded to EAN-13 and GTIN-14
 * (a leading zero does not change the check digit).
 */
export function walmartLookupCodes(upc: string | undefined | null): string[] {
  const out: string[] = [];
  const primary = walmartUpcForLookup(upc);
  pushCode(out, primary, /^\d{12}$/);
  if (primary && primary.length === 12) {
    pushCode(out, `0${primary}`, /^\d{13}$/);
    pushCode(out, `00${primary}`, /^\d{14}$/);
  }
  return out;
}

/**
 * The one Kroger product id to ask for. Extra 12- and 14-digit pads were
 * rejected with PRODUCT-4111-400. A miss falls back to a name search.
 */
export function krogerLookupCodes(upc: string | undefined | null): string[] {
  const primary = krogerProductIdForLookup(upc);
  return primary ? [primary] : [];
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
    ...(publishSale({
      price: record.price,
      onSale: Boolean(record.onSale),
      regularPrice: record.regularPrice,
      saleEndsOn: record.saleEndsOn,
    }) ?? {}),
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
