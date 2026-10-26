/**
 * Product families for the shelf.
 *
 * A family is one tile: brand + flavor/variety, with pack count, unit size,
 * and container as variants inside the tile. Diet Coke, Coke Zero, and Cherry
 * Coke stay separate families. A 12-pack of 12 fl oz cans and a 2 L bottle of
 * the same flavor collapse onto one tile.
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
  /** Flavor line with the brand removed. Empty means the flagship. */
  flavor: string;
  variant: FamilyVariantShape;
};

export type BrowseVariant = BrowseProduct & {
  label: string;
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

export type BrowseTile = BrowseProduct & {
  familyKey: string;
  familyName: string;
  /** Retailer title of the default variant, kept for list pins. */
  catalogName: string;
  variantLabel: string;
  variants: BrowseVariant[];
  defaultVariantId: string;
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
  const sizeCodeMatch = combined.match(/\bsize\s+(\d+)\b/i);
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

const PACKAGING_PATTERNS: RegExp[] = [
  /\bpack\s+of\s+\d+(?:\.\d+)?\b/gi,
  /\b\d+(?:\.\d+)?\s*-\s*packs?\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:packs?|pk)\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:counts?|ct)\b/gi,
  /\b(?:party|family|snack|share|king|value|mega|super)\s+size\b/gi,
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

function flavorOf(display: string, brand: string): string {
  const parent = parentBrand(brand);
  const drop = removableBrandTokens(parent.key);
  let parts = tokens(display).filter((token) => !drop.has(token) && !SIZE_TOKENS.has(token));
  if (parts.includes("zero")) {
    parts = parts.filter((token) => token !== "sugar");
  }
  const specific = parts.filter((token) => !FORM_TOKENS.has(token));
  if (specific.length > 0) {
    parts = specific;
  }
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
  const flavor = flavorOf(display, brand);
  const departmentId = input.departmentId?.trim().toLowerCase() || "";
  const familyKey = `${departmentId}|${parent.key}|${flavor}`;
  return {
    familyKey,
    familyName: display || brand || "Product",
    flavor,
    variant,
  };
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
    label: shape.label,
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
    seen.set(variant.label, (seen.get(variant.label) ?? 0) + 1);
  }
  return variants.map((variant) => {
    if ((seen.get(variant.label) ?? 0) < 2) return variant;
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
    let variants = disambiguateLabels(members.map(toVariant).sort(variantOrder));
    const fallback = variants[0];
    if (!fallback) continue;
    const chosen = chooseDefaultVariant(variants);
    const familyName = preferredName(identities.map((identity) => identity.familyName));
    const prices = variants.map((variant) => variant.price).filter((price) => Number.isFinite(price));
    const priceFrom = prices.length ? Math.min(...prices) : chosen.price;
    const priceTo = prices.length ? Math.max(...prices) : chosen.price;
    tiles.push({
      ...chosen,
      name: familyName,
      catalogName: chosen.name,
      familyKey: key,
      familyName,
      variantLabel: chosen.label,
      sizeLabel: chosen.label,
      variants,
      defaultVariantId: chosen.id,
      priceFrom,
      priceTo,
      imageUrls: chosen.imageUrls.length > 0 ? chosen.imageUrls : fallback.imageUrls,
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
    catalogName: product.name,
    familyKey: identity.familyKey,
    familyName: identity.familyName,
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
