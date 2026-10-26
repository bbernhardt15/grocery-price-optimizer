/**
 * Product families for the shelf.
 *
 * A family is one tile: a brand's product line (Oreo cookies, not Oreo ice
 * cream). Flavor and variety are chips inside that tile. Pack count, unit
 * size, and container are the size chips. A name with no shared product line
 * stays strict, so Diet Coke does not join Coca-Cola and club soda does not
 * join tonic water.
 *
 * The key is computed from the name at read time, so browse does not need a
 * precomputed column to be correct. Catalog upserts also store `familyKey`
 * so admin scans of the ~78k master collection can group with an index.
 */

import {
  normalizeSizeText,
  parsePackageSize,
  stripPackageSizePhrases,
  type ParsedPackageSize,
  type SizeDimension,
} from "../packageSize";
import type { BrowseProduct, CatalogGap, CatalogOffer, PackageSizeSummary } from "./types";

const UNIT =
  "floz|fluid\\s+ounces?|fl\\.?\\s*oz|gallons?|gal|quarts?|qt|pints?|pt|milliliters?|ml|liters?|litres?|kilograms?|kg|grams?|pounds?|lbs?|ounces?|oz|counts?|ct|packs?|pk|pieces?|pcs?|each|ea|dozens?|l|g";

const SIZE_TOKENS = new Set([
  "oz",
  "floz",
  "fl",
  "lb",
  "lbs",
  "gal",
  "gallon",
  "gallons",
  "ml",
  "kg",
  "liter",
  "liters",
  "litre",
  "litres",
  "count",
  "ct",
  "pk",
  "pack",
  "packs",
  "can",
  "cans",
  "bottle",
  "bottles",
]);

/** Category nouns. Dropped from the flavor only when a real variety word remains. */
const FORM_TOKENS = new Set(["chips", "chip", "tortilla", "crisps", "cookies", "cookie", "crackers", "cracker"]);

/** Brand strings retailers use for a flavor of a parent brand. */
const BRAND_ALIASES: Record<string, { key: string; flavor: string[] }> = {
  "diet coke": { key: "coca cola", flavor: ["diet"] },
  "coke zero": { key: "coca cola", flavor: ["zero"] },
  "coke zero sugar": { key: "coca cola", flavor: ["zero"] },
  "coca cola zero": { key: "coca cola", flavor: ["zero"] },
  "coca cola zero sugar": { key: "coca cola", flavor: ["zero"] },
  "cherry coke": { key: "coca cola", flavor: ["cherry"] },
  "cherry coca cola": { key: "coca cola", flavor: ["cherry"] },
  "caffeine free diet coke": { key: "coca cola", flavor: ["caffeine", "free", "diet"] },
  coke: { key: "coca cola", flavor: [] },
  "coca cola": { key: "coca cola", flavor: [] },
  "diet pepsi": { key: "pepsi", flavor: ["diet"] },
  "pepsi zero": { key: "pepsi", flavor: ["zero"] },
  "pepsi zero sugar": { key: "pepsi", flavor: ["zero"] },
  pepsi: { key: "pepsi", flavor: [] },
};

const SINGULAR_CONTAINER: Record<string, string> = {
  "mini cans": "mini can",
  cans: "can",
  bottles: "bottle",
  "glass bottles": "glass bottle",
  cartons: "carton",
  jugs: "jug",
  bags: "bag",
  boxes: "box",
  pouches: "pouch",
  jars: "jar",
  tubs: "tub",
  cups: "cup",
  trays: "tray",
  sleeves: "sleeve",
};

export type FamilyVariantShape = {
  count: number | null;
  unitAmount: number | null;
  unitDimension: SizeDimension | null;
  unitLabel: string | null;
  totalAmount: number | null;
  totalDimension: SizeDimension | null;
  totalLabel: string | null;
  container: string | null;
  /** Diaper and similar numbered sizes ("Size 3"). Not a flavor. */
  sizeCode: string | null;
  label: string;
  /** Stable identity of this size/pack inside the family. */
  signature: string;
};

export type FamilyIdentity = {
  familyKey: string;
  familyName: string;
  /** Product line such as cookies or ice cream. Empty when the name has none. */
  line: string;
  lineLabel: string;
  /** Flavor line with the brand removed. Empty means the flagship. */
  flavor: string;
  flavorLabel: string;
  variant: FamilyVariantShape;
};

export type BrowseVariant = BrowseProduct & {
  label: string;
  flavorKey: string;
  flavorLabel: string;
  count: number | null;
  unitSize: PackageSizeSummary | null;
  totalSize: PackageSizeSummary | null;
  container: string | null;
  sizeCode: string | null;
  /** Cheapest in-stock shelf price. */
  price: number;
  storeName: string;
  unitPrice?: number;
  unitPriceText?: string;
  gaps?: CatalogGap[];
};

export type FamilyFlavor = {
  key: string;
  label: string;
  count: number;
};

export type BrowseTile = BrowseProduct & {
  familyKey: string;
  familyName: string;
  /** Retailer title of the default variant, kept for list pins. */
  catalogName: string;
  variantLabel: string;
  flavorLabel: string;
  line: string;
  flavors: FamilyFlavor[];
  variants: BrowseVariant[];
  defaultVariantId: string;
  /** Median shelf price of the default variant. The tile does not name a store. */
  typicalPrice: number;
  priceFrom: number;
  priceTo: number;
  gaps?: CatalogGap[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .split(/[^a-z0-9%/]+/)
    .filter((token) => token.length > 0);
}

function parentBrand(brand: string): { key: string; flavor: string[] } {
  const key = tokens(brand).join(" ");
  return BRAND_ALIASES[key] ?? { key: key || "unbranded", flavor: [] };
}

function removableBrandTokens(brandKey: string): Set<string> {
  const set = new Set(tokens(brandKey));
  if (brandKey === "coca cola") {
    set.add("coca");
    set.add("cola");
    set.add("coke");
  }
  if (brandKey === "pepsi") {
    set.add("pepsi");
    set.add("cola");
  }
  return set;
}

function containerOf(text: string, unit: ParsedPackageSize | null): string | null {
  const lower = text.toLowerCase();
  const miniWord = /\b(?:mini|sleek)\b/.test(lower);
  const can = /\bcans?\b/.test(lower);
  const smallCan = unit?.dimension === "volume" && unit.amount > 0 && unit.amount <= 7.5;
  if ((can && (miniWord || smallCan)) || (miniWord && smallCan)) {
    return "mini cans";
  }
  if (/\bglass\s+bottles?\b/.test(lower)) return "glass bottles";
  if (/\bbottles?\b/.test(lower)) return "bottles";
  if (can) return "cans";
  if (/\bcartons?\b/.test(lower)) return "cartons";
  if (/\bjugs?\b/.test(lower)) return "jugs";
  if (/\bbags?\b/.test(lower)) return "bags";
  if (/\bbox(?:es)?\b/.test(lower)) return "boxes";
  if (/\bpouches?\b/.test(lower)) return "pouches";
  if (/\bjars?\b/.test(lower)) return "jars";
  if (/\btubs?\b/.test(lower)) return "tubs";
  if (/\bcups?\b/.test(lower)) return "cups";
  if (/\btrays?\b/.test(lower)) return "trays";
  if (/\bsleeves?\b/.test(lower)) return "sleeves";
  return null;
}

function containerLabel(container: string | null, count: number | null): string | null {
  if (!container) return null;
  if (count === 1) return SINGULAR_CONTAINER[container] ?? container;
  return container;
}

function firstPhysical(normalized: string): ParsedPackageSize | null {
  const match = normalized.match(
    new RegExp(
      `(\\d+(?:\\.\\d+)?)\\s*(floz|gallons?|gal|quarts?|qt|pints?|pt|milliliters?|ml|liters?|litres?|kilograms?|kg|grams?|pounds?|lbs?|ounces?|oz|l|g)\\b`,
      "i"
    )
  );
  if (!match?.[1] || !match[2]) return null;
  return parsePackageSize(`${match[1]} ${match[2]}`);
}

function firstCount(normalized: string): { count: number; packWord: boolean } | null {
  const pack = normalized.match(/\b(\d+(?:\.\d+)?)\s*(?:packs?|pk)\b/i);
  if (pack?.[1]) {
    const count = Number(pack[1]);
    if (count > 0) return { count, packWord: true };
  }
  const counted = normalized.match(
    /\b(\d+(?:\.\d+)?)\s*(?:counts?|ct|pieces?|pcs?|each|ea|cans?|bottles?|bags?|boxes|cartons?|jugs?|pouches?|jars?|tubs?|cups?|trays?|sleeves?|rolls?)\b/i
  );
  if (counted?.[1]) {
    const count = Number(counted[1]);
    if (count > 1) return { count, packWord: false };
  }
  return null;
}

function structureOf(text: string): { count: number | null; unit: ParsedPackageSize | null; packWord: boolean } {
  const normalized = normalizeSizeText(text);
  const multi = normalized.match(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT})\\b`, "i")
  );
  if (multi?.[1] && multi[2] && multi[3] && !/^(?:packs?|pk|counts?|ct)$/i.test(multi[3])) {
    const unit = parsePackageSize(`${multi[2]} ${multi[3]}`);
    if (unit && unit.dimension !== "count") {
      return { count: Number(multi[1]), unit, packWord: true };
    }
  }
  const packOf = normalized.match(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:packs?|pk)\\s*(?:of\\s+)?(\\d+(?:\\.\\d+)?)\\s*(${UNIT})\\b`, "i")
  );
  if (packOf?.[1] && packOf[2] && packOf[3] && !/^(?:packs?|pk|counts?|ct|cans?|bottles?)$/i.test(packOf[3])) {
    const unit = parsePackageSize(`${packOf[2]} ${packOf[3]}`);
    if (unit && unit.dimension !== "count") {
      return { count: Number(packOf[1]), unit, packWord: true };
    }
  }
  const unit = firstPhysical(normalized);
  const counted = firstCount(normalized);
  if (unit && counted && counted.count > 1) {
    return { count: counted.count, unit, packWord: counted.packWord };
  }
  if (unit) {
    return { count: 1, unit, packWord: false };
  }
  if (counted) {
    return { count: counted.count, unit: null, packWord: counted.packWord };
  }
  return { count: null, unit: null, packWord: false };
}

function describeVariant(name: string, size?: string | null): FamilyVariantShape {
  const combined = `${size ?? ""} ${name}`.replace(/\s+/g, " ").trim();
  const structured = structureOf(combined);
  const unit = structured.unit;
  const count = structured.count;
  const container = containerOf(combined, unit);
  const sizeCodeMatch = combined.match(/\bsize\s+(\d+)\b(?!\s*\.\d)(?!\s*(?:oz|lb|fl|ml|g|gal|kg|pk|ct|l)\b)/i);
  const sizeCode = sizeCodeMatch ? `Size ${sizeCodeMatch[1]}` : null;
  const unitLabel = unit?.label ?? null;
  const totalAmount = unit && count && count > 1 ? round2(unit.amount * count) : unit ? round2(unit.amount) : count;
  const totalDimension: SizeDimension | null = unit?.dimension ?? (count ? "count" : null);
  const totalLabel =
    unit && count && count > 1 ? `${trimNumber(count)} x ${unit.label}` : unitLabel ?? (count ? `${trimNumber(count)} ct` : null);
  const shownContainer = containerLabel(container, count);
  const bits: string[] = [];
  if (sizeCode) bits.push(sizeCode);
  if (unitLabel && count && count > 1) {
    bits.push(`${trimNumber(count)} pk`);
    bits.push([unitLabel, shownContainer].filter(Boolean).join(" "));
  } else if (unitLabel) {
    bits.push([unitLabel, shownContainer].filter(Boolean).join(" "));
  } else if (count && count > 1) {
    bits.push(`${trimNumber(count)} ${structured.packWord ? "pk" : "ct"}`);
    if (shownContainer) bits.push(shownContainer);
  } else if (shownContainer) {
    bits.push(shownContainer);
  }
  const tier = packTier(combined);
  if (tier) bits.push(tier);
  const label = bits.filter(Boolean).join(" · ") || "Standard";
  const signature = [
    count ?? "",
    unit?.dimension ?? "",
    unit ? round2(unit.amount) : "",
    container ?? "",
    sizeCode ?? "",
  ].join("|");
  return {
    count,
    unitAmount: unit ? round2(unit.amount) : null,
    unitDimension: unit?.dimension ?? null,
    unitLabel,
    totalAmount: totalAmount == null ? null : round2(totalAmount),
    totalDimension,
    totalLabel,
    container,
    sizeCode,
    label,
    signature,
  };
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round2(value));
}

/** Shoppers pick these as a size, not as a flavor (King size, Family size, Snack pack). */
function packTier(text: string): string | null {
  const named = text.match(/\b(king|family|party|share|mega|value|super)\s+size\b/i);
  if (named?.[1]) return `${named[1].charAt(0).toUpperCase()}${named[1].slice(1).toLowerCase()} size`;
  if (/\bsnack\s+packs?\b/i.test(text)) return "Snack pack";
  return null;
}

const PACKAGING_PATTERNS: RegExp[] = [
  /\bpack\s+of\s+\d+(?:\.\d+)?\b/gi,
  /\b\d+(?:\.\d+)?\s*-\s*packs?\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:packs?|pk)\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:counts?|ct)\b/gi,
  /\b(?:party|family|snack|share|king|value|mega|super)\s+size\b/gi,
  /\bsnack\s+packs?\b/gi,
  /\bgrab\s+bags?\b/gi,
  /\bsingle[\s-]*serve\b/gi,
  /\bfridge\s+packs?\b/gi,
  /\bmulti[\s-]*packs?\b/gi,
  /\bsize\s+\d+\b/gi,
  /\bgrade\s+a\b/gi,
  /\bmini\s+cans?\b/gi,
  /\bsleek\s+cans?\b/gi,
  /\bglass\s+bottles?\b/gi,
  /\bplastic\s+bottles?\b/gi,
  /\b(?:cans?|bottles?|cartons?|jugs?|bags?|boxes|box|pouches?|jars?|tubs?|cups?|trays?|sleeves?)\b/gi,
  /\b(?:classic|original)\b/gi,
  /\bsoft\s+drinks?\b/gi,
  /\b(?<!baking\s)(?<!club\s)(?<!cream\s)(?<!caustic\s)(?<!washing\s)sodas?\b/gi,
];

function cleanedName(name: string, variant: FamilyVariantShape): string {
  let text = name.replace(/[®™©]/g, " ");
  text = stripPackageSizePhrases(text);
  for (const pattern of PACKAGING_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, " ");
  }
  if (variant.container === "mini cans" || (variant.unitDimension === "volume" && (variant.unitAmount ?? 99) <= 7.5)) {
    text = text.replace(/\b(?:mini|sleek)\b/gi, " ");
  }
  text = text.replace(/\btortilla\s+chips\b/gi, " ");
  text = text.replace(/\bpotato\s+chips\b/gi, " ");
  const withoutForm = text.replace(/\b(?:chips|cookies|crackers)\b/gi, " ");
  if (tokens(withoutForm).length > 0) {
    text = withoutForm;
  }
  text = text.replace(/[()[\],;/]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/^[-–—|]+|[-–—|]+$/g, "").trim();
  return text;
}

const PRODUCT_LINES: Array<{ pattern: RegExp; line: string; label: string }> = [
  { pattern: /\bice\s+creams?\b/i, line: "ice cream", label: "Ice Cream" },
  { pattern: /\bcereals?\b/i, line: "cereal", label: "Cereal" },
  { pattern: /\bcookies?\b/i, line: "cookies", label: "Cookies" },
  { pattern: /\b(?:tortilla\s+|potato\s+)?chips\b/i, line: "chips", label: "Chips" },
  { pattern: /\bcrackers?\b/i, line: "crackers", label: "Crackers" },
  { pattern: /\bmilks?\b/i, line: "milk", label: "Milk" },
  { pattern: /\beggs?\b/i, line: "eggs", label: "Eggs" },
  { pattern: /\byogurts?\b/i, line: "yogurt", label: "Yogurt" },
  { pattern: /\bclub\s+sodas?\b/i, line: "club soda", label: "Club Soda" },
  { pattern: /\bbaking\s+sodas?\b/i, line: "baking soda", label: "Baking Soda" },
  { pattern: /\bcream\s+sodas?\b/i, line: "cream soda", label: "Cream Soda" },
  { pattern: /\btonic(?:\s+water)?\b/i, line: "tonic water", label: "Tonic Water" },
  { pattern: /\bsoft\s+drinks?\b/i, line: "soda", label: "Soda" },
  { pattern: /(?<!club\s)(?<!baking\s)(?<!cream\s)(?<!caustic\s)(?<!washing\s)\bsodas?\b/i, line: "soda", label: "Soda" },
];

const LINE_WORDS: Record<string, Set<string>> = {
  cookies: new Set(["cookie", "cookies", "sandwich"]),
  chips: new Set(["chip", "chips", "tortilla", "potato", "crisps"]),
  crackers: new Set(["cracker", "crackers"]),
  milk: new Set(["milk"]),
  eggs: new Set(["egg", "eggs"]),
  yogurt: new Set(["yogurt", "yoghurt"]),
  "ice cream": new Set(["ice", "cream", "icecream"]),
  cereal: new Set(["cereal"]),
  soda: new Set(["soda", "soft", "drink"]),
  "club soda": new Set(["club", "soda"]),
  "baking soda": new Set(["baking", "soda"]),
  "cream soda": new Set(["cream", "soda"]),
  "tonic water": new Set(["tonic", "water"]),
};

function brandLine(brandKey: string, departmentId: string): { line: string; label: string } | null {
  if (brandKey === "doritos" && departmentId === "snacks") return { line: "chips", label: "Chips" };
  if (brandKey === "oreo" && departmentId === "snacks") return { line: "cookies", label: "Cookies" };
  return null;
}

function detectLine(text: string): { line: string; label: string } | null {
  for (const rule of PRODUCT_LINES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) return { line: rule.line, label: rule.label };
  }
  return null;
}

function flavorLabelOf(key: string): string {
  if (!key) return "Original";
  return key
    .split(" ")
    .map((word) => {
      if (word === "stuf" || word === "stuff") return "Stuf";
      if (word === "2%" || /^\d/.test(word)) return word.toUpperCase() === word ? word : word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function flavorOf(display: string, brand: string, line: string): string {
  const parent = parentBrand(brand);
  const drop = removableBrandTokens(parent.key);
  const stop = new Set(["and", "n", "with", "the", "of", "style", "flavored", "flavor"]);
  let parts = tokens(display).filter(
    (token) => !drop.has(token) && !SIZE_TOKENS.has(token) && !stop.has(token) && !/^\d+$/.test(token)
  );
  if (line === "cookies") {
    parts = tokens(parts.join(" ").replace(/\bchocolate\s+sandwich\b/g, " "));
  }
  const lineWords = LINE_WORDS[line] ?? new Set<string>();
  parts = parts.filter((token) => !lineWords.has(token));
  if ((!line || line === "soda") && parts.includes("zero")) {
    parts = parts.filter((token) => token !== "sugar");
  }
  const specific = parts.filter((token) => !FORM_TOKENS.has(token));
  if (specific.length > 0) parts = specific;
  const flavor = [...parent.flavor];
  for (const token of parts) {
    if (!flavor.includes(token)) flavor.push(token);
  }
  return flavor.join(" ");
}

export function identifyFamily(input: {
  brand?: string | null;
  name?: string | null;
  size?: string | null;
  departmentId?: string | null;
}): FamilyIdentity {
  const brand = input.brand?.trim() || "";
  const name = input.name?.trim() || "";
  const variant = describeVariant(name, input.size);
  const display = cleanedName(name, variant) || brand || name;
  const parent = parentBrand(brand);
  const departmentId = input.departmentId?.trim().toLowerCase() || "";
  const found = detectLine(`${name} ${display}`) ?? brandLine(parent.key, departmentId);
  const flavor = flavorOf(display, brand, found?.line ?? "");
  const familyKey = found
    ? `${departmentId}|${parent.key}|line:${found.line}`
    : `${departmentId}|${parent.key}|${flavor}`;
  const familyName = display || brand || "Product";
  return {
    familyKey,
    familyName: familyName.replace(/\s+/g, " ").trim() || brand || "Product",
    line: found?.line ?? "",
    lineLabel: found?.label ?? "",
    flavor,
    flavorLabel: flavorLabelOf(flavor),
    variant,
  };
}

const BAD_IMAGE =
  /nutrition|nutrient|facts|ingredient|barcode|banner|swatch|lifestyle|drug.?fact|supplement|[/_-](?:back|left|right|top|bottom)(?:[^\w]|$)/i;
const GOOD_IMAGE = /(?:^|[^\w])(?:front|primary|hero|main)(?:[^\w]|$)/i;

function imageQuality(url: string): number {
  let score = 0;
  if (BAD_IMAGE.test(url)) score -= 30;
  if (GOOD_IMAGE.test(url)) score += 10;
  return score;
}

/** Prefer a front-of-pack photo over a nutrition panel, banner, or ingredient shot. */
export function rankProductImages(urls: string[]): string[] {
  const list = urls.filter((url) => url.trim().length > 0);
  return list
    .map((url, index) => ({ url, score: imageQuality(url), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.url);
}

/**
 * Use this variant's own photo when it looks like a package front. If every
 * shot is a nutrition panel or banner, borrow a front from the same flavor.
 */
function frontImages(variant: BrowseVariant, siblings: BrowseVariant[]): string[] {
  const own = rankProductImages(variant.imageUrls);
  if (own[0] && imageQuality(own[0]) >= 0) return own;
  const donated = rankProductImages(
    siblings.filter((other) => other.flavorKey === variant.flavorKey).flatMap((other) => other.imageUrls)
  ).filter((url) => imageQuality(url) > 0);
  const rest = own.filter((url) => !donated.includes(url));
  return donated.length > 0 ? [...donated, ...rest] : own;
}

function calmBrand(brand: string): string {
  const trimmed = brand.trim();
  if (!trimmed || trimmed !== trimmed.toUpperCase() || !/[A-Za-z]/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (_, sep: string, letter: string) => `${sep}${letter.toUpperCase()}`);
}

function typicalPrice(product: BrowseProduct): number {
  const prices = product.offers
    .map((offer) => offer.price)
    .filter((price) => Number.isFinite(price) && price >= 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) return product.bestOffer.price;
  const mid = Math.floor((prices.length - 1) / 2);
  return prices.length % 2 === 1 ? prices[mid]! : round2((prices[mid]! + prices[mid + 1]!) / 2);
}

/**
 * Keep the first screen from filling up with one brand. Later tiles stay
 * available behind the next page.
 */
export function diversifyFamilies<T extends { brand?: string; familyName?: string }>(
  tiles: T[],
  pageSize = 8,
  maxPerBrand = 3
): T[] {
  const first: T[] = [];
  const rest: T[] = [];
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    const brand = (tile.brand || tile.familyName || "").trim().toLowerCase() || "other";
    const seen = counts.get(brand) ?? 0;
    if (first.length < pageSize && seen < maxPerBrand) {
      first.push(tile);
      counts.set(brand, seen + 1);
    } else {
      rest.push(tile);
    }
  }
  return [...first, ...rest];
}

function sizeSummary(amount: number | null, dimension: SizeDimension | null, label: string | null): PackageSizeSummary | null {
  if (amount == null || !dimension || !label) return null;
  return { dimension, amount, label };
}

function valuePerBase(price: number, totalAmount: number | null): number | null {
  if (!(price >= 0) || totalAmount == null || !(totalAmount > 0)) return null;
  return price / totalAmount;
}

function toVariant(product: BrowseProduct): BrowseVariant {
  const identity = identifyFamily({
    brand: product.brand,
    name: product.name,
    size: product.sizeLabel,
    departmentId: product.departmentId,
  });
  const shape = identity.variant;
  const offer = product.bestOffer;
  return {
    ...product,
    imageUrls: rankProductImages(product.imageUrls),
    label: shape.label,
    flavorKey: identity.flavor,
    flavorLabel: identity.flavorLabel,
    count: shape.count,
    unitSize: sizeSummary(shape.unitAmount, shape.unitDimension, shape.unitLabel),
    totalSize: sizeSummary(shape.totalAmount, shape.totalDimension, shape.totalLabel),
    container: shape.container,
    sizeCode: shape.sizeCode,
    price: offer.price,
    storeName: offer.storeName,
    ...(offer.unitPrice != null ? { unitPrice: offer.unitPrice } : {}),
    ...(offer.unitPriceText ? { unitPriceText: offer.unitPriceText } : {}),
  };
}

/**
 * Best value is the lowest price per base unit (fl oz, oz, or each), so a
 * $/gal figure is not compared with a $/fl oz figure. When nothing has a
 * size, the variant closest to the median package wins, then the one sold
 * at the most stores.
 */
export function chooseDefaultVariant(variants: BrowseVariant[]): BrowseVariant {
  const ranked = variants.map((variant) => ({
    variant,
    value: valuePerBase(variant.price, variant.totalSize?.amount ?? null),
  }));
  const valued = ranked.filter((row) => row.value != null);
  if (valued.length > 0) {
    valued.sort(
      (a, b) =>
        (a.value ?? 0) - (b.value ?? 0) ||
        b.variant.offers.length - a.variant.offers.length ||
        a.variant.price - b.variant.price ||
        a.variant.label.localeCompare(b.variant.label)
    );
    return valued[0]!.variant;
  }
  const amounts = variants
    .map((variant) => variant.totalSize?.amount)
    .filter((amount): amount is number => typeof amount === "number")
    .sort((a, b) => a - b);
  const median = amounts.length > 0 ? amounts[Math.floor((amounts.length - 1) / 2)]! : null;
  return variants
    .slice()
    .sort((a, b) => {
      const left = median == null || a.totalSize?.amount == null ? Number.POSITIVE_INFINITY : Math.abs(a.totalSize.amount - median);
      const right = median == null || b.totalSize?.amount == null ? Number.POSITIVE_INFINITY : Math.abs(b.totalSize.amount - median);
      return left - right || b.offers.length - a.offers.length || a.price - b.price || a.label.localeCompare(b.label);
    })[0]!;
}

function shopperVariantLabel(flavor: string, size: string, showFlavor: boolean): string {
  if (!showFlavor || !flavor || flavor === "Original") return size;
  if (size && size !== "Standard") return `${flavor} · ${size}`;
  return flavor;
}

function preferredName(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0]?.[0] ?? "Product";
}

function variantOrder(a: BrowseVariant, b: BrowseVariant): number {
  const rank = (dimension: SizeDimension | undefined) => (dimension === "volume" ? 0 : dimension === "weight" ? 1 : dimension === "count" ? 2 : 3);
  return (
    rank(a.totalSize?.dimension) - rank(b.totalSize?.dimension) ||
    (a.totalSize?.amount ?? Number.POSITIVE_INFINITY) - (b.totalSize?.amount ?? Number.POSITIVE_INFINITY) ||
    (a.count ?? 0) - (b.count ?? 0) ||
    a.label.localeCompare(b.label) ||
    a.id.localeCompare(b.id)
  );
}

function disambiguateLabels(variants: BrowseVariant[]): BrowseVariant[] {
  const seen = new Map<string, number>();
  for (const variant of variants) {
    const key = `${variant.flavorKey}|${variant.label}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return variants.map((variant) => {
    const key = `${variant.flavorKey}|${variant.label}`;
    if ((seen.get(key) ?? 0) < 2) return variant;
    return { ...variant, label: `${variant.label} · $${variant.price.toFixed(2)}` };
  });
}

export function groupBrowseFamilies(products: BrowseProduct[]): BrowseTile[] {
  const groups = new Map<string, BrowseProduct[]>();
  const order: string[] = [];
  for (const product of products) {
    const identity = identifyFamily({
      brand: product.brand,
      name: product.name,
      size: product.sizeLabel,
      departmentId: product.departmentId,
    });
    const key = product.name.trim() ? identity.familyKey : `solo|${product.id}`;
    if (!groups.has(key)) {
      order.push(key);
      groups.set(key, []);
    }
    groups.get(key)?.push(product);
  }

  const tiles: BrowseTile[] = [];
  for (const key of order) {
    const members = groups.get(key) ?? [];
    const identities = members.map((product) =>
      identifyFamily({
        brand: product.brand,
        name: product.name,
        size: product.sizeLabel,
        departmentId: product.departmentId,
      })
    );
    const labeled = disambiguateLabels(members.map(toVariant).sort(variantOrder));
    let variants = labeled.map((variant) => ({
      ...variant,
      imageUrls: frontImages(variant, labeled),
    }));
    const fallback = variants[0];
    if (!fallback) continue;
    const chosen = chooseDefaultVariant(variants);
    const line = identities.find((identity) => identity.line);
    const flavorCounts = new Map<string, { label: string; count: number }>();
    for (const variant of variants) {
      const row = flavorCounts.get(variant.flavorKey) ?? { label: variant.flavorLabel, count: 0 };
      row.count += 1;
      flavorCounts.set(variant.flavorKey, row);
    }
    const flavors = [...flavorCounts.entries()]
      .map(([key, row]) => ({ key, label: row.label, count: row.count }))
      .sort((a, b) => Number(b.key === "") - Number(a.key === "") || a.label.localeCompare(b.label));
    const brandName = calmBrand(members.find((member) => member.brand.trim())?.brand.trim() || "");
    const lineTitle = !line
      ? ""
      : brandName.toLowerCase().includes(line.lineLabel.toLowerCase())
        ? brandName
        : `${brandName} ${line.lineLabel}`.trim();
    const cleaned = preferredName(identities.map((identity) => identity.familyName));
    const familyName =
      line && flavors.length > 1
        ? lineTitle
        : line?.line === "ice cream" && /and cream/i.test(cleaned)
          ? lineTitle
          : cleaned;
    const prices = variants.map((variant) => variant.price).filter((price) => Number.isFinite(price));
    const priceFrom = prices.length ? Math.min(...prices) : chosen.price;
    const priceTo = prices.length ? Math.max(...prices) : chosen.price;
    const shownLabel = shopperVariantLabel(chosen.flavorLabel, chosen.label, flavors.length > 1);
    tiles.push({
      ...chosen,
      name: familyName,
      catalogName: chosen.name,
      familyKey: key,
      familyName,
      line: line?.line ?? "",
      flavors,
      flavorLabel: flavors.length > 1 ? chosen.flavorLabel : "",
      variantLabel: shownLabel,
      sizeLabel: shownLabel,
      variants: variants.map((variant) => ({
        ...variant,
        flavorLabel: flavors.length > 1 ? variant.flavorLabel : "",
        variantLabel: shopperVariantLabel(variant.flavorLabel, variant.label, flavors.length > 1),
      })),
      defaultVariantId: chosen.id,
      typicalPrice: typicalPrice(chosen),
      priceFrom,
      priceTo,
      imageUrls: (variants.find((variant) => variant.id === chosen.id) ?? fallback).imageUrls,
    });
  }
  return tiles;
}

export function groupingStats(tiles: BrowseTile[]): {
  products: number;
  families: number;
  groupedFamilies: number;
  groupedProducts: number;
  groupedShare: number;
} {
  const products = tiles.reduce((sum, tile) => sum + tile.variants.length, 0);
  const grouped = tiles.filter((tile) => tile.variants.length > 1);
  const groupedProducts = grouped.reduce((sum, tile) => sum + tile.variants.length, 0);
  return {
    products,
    families: tiles.length,
    groupedFamilies: grouped.length,
    groupedProducts,
    groupedShare: products === 0 ? 0 : groupedProducts / products,
  };
}

export type FamilySampleGroup = {
  familyKey: string;
  familyName: string;
  brand: string;
  count: number;
  variants: Array<{ id: string; name: string; label: string }>;
};

export function summarizeFamilyRows(
  rows: Array<{ key?: string; name?: string; brand?: string; size?: string; departmentId?: string }>,
  limit = 20
): {
  scanned: number;
  families: number;
  groupedFamilies: number;
  groupedProducts: number;
  groupedShare: number;
  groups: FamilySampleGroup[];
} {
  const buckets = new Map<string, FamilySampleGroup>();
  for (const row of rows) {
    const identity = identifyFamily({
      brand: row.brand,
      name: row.name,
      size: row.size,
      departmentId: row.departmentId,
    });
    const id = row.key || identity.familyName;
    let bucket = buckets.get(identity.familyKey);
    if (!bucket) {
      bucket = {
        familyKey: identity.familyKey,
        familyName: identity.familyName,
        brand: row.brand?.trim() || "",
        count: 0,
        variants: [],
      };
      buckets.set(identity.familyKey, bucket);
    }
    bucket.count += 1;
    if (bucket.variants.length < 12) {
      bucket.variants.push({ id, name: row.name?.trim() || "", label: identity.variant.label });
    }
    if (identity.familyName.length > bucket.familyName.length) {
      bucket.familyName = identity.familyName;
    }
  }
  const groups = [...buckets.values()];
  const grouped = groups.filter((group) => group.count > 1);
  const groupedProducts = grouped.reduce((sum, group) => sum + group.count, 0);
  const shown = groups
    .slice()
    .sort((a, b) => b.count - a.count || a.familyName.localeCompare(b.familyName))
    .slice(0, Math.min(50, Math.max(1, limit)));
  return {
    scanned: rows.length,
    families: groups.length,
    groupedFamilies: grouped.length,
    groupedProducts,
    groupedShare: rows.length === 0 ? 0 : groupedProducts / rows.length,
    groups: shown,
  };
}

export function annotateBrowseProduct<T extends BrowseProduct>(product: T): T & {
  familyKey: string;
  familyName: string;
  variantLabel: string;
  flavorLabel: string;
  catalogName: string;
} {
  const identity = identifyFamily({
    brand: product.brand,
    name: product.name,
    size: product.sizeLabel,
    departmentId: product.departmentId,
  });
  return {
    ...product,
    imageUrls: rankProductImages(product.imageUrls),
    catalogName: product.name,
    familyKey: identity.familyKey,
    familyName: identity.familyName,
    flavorLabel: identity.flavorLabel,
    variantLabel: identity.variant.label,
  };
}

/** Per-store availability is the offer list. This narrows a tile to one variant for the shopper. */
export function variantOfferRows(offers: CatalogOffer[]): Array<{
  storeName: string;
  price: number;
  availability: CatalogOffer["availability"];
  unitPrice?: number;
  unitPriceText?: string;
}> {
  return offers.map((offer) => ({
    storeName: offer.storeName,
    price: offer.price,
    availability: offer.availability,
    ...(offer.unitPrice != null ? { unitPrice: offer.unitPrice } : {}),
    ...(offer.unitPriceText ? { unitPriceText: offer.unitPriceText } : {}),
  }));
}
