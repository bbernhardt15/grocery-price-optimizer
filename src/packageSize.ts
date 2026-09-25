/**
 * Package size parsing for fair price comparison.
 *
 * Amounts are normalized to a base unit so stores can be compared:
 * volume → fluid ounces, weight → ounces, count → each.
 * Display strings use a shopper-scale unit ($/gal, $/fl oz, $/lb, $/oz, $/ct).
 */

export type SizeDimension = "volume" | "weight" | "count";

export type ParsedPackageSize = {
  dimension: SizeDimension;
  /** volume: fl oz; weight: oz; count: each */
  amount: number;
  label: string;
  /** True for "6 pack" / "6 pk" so a following measure can be multiplied. */
  packWord?: boolean;
};

const FL_OZ_PER_LITER = 33.8140227018;
const OZ_PER_KG = 35.27396195;

type Measure = ParsedPackageSize;

const UNIT_ALTERNATION =
  "floz|gallons?|gal|quarts?|qt|pints?|pt|milliliters?|ml|liters?|litres?|kilograms?|kg|grams?|pounds?|lbs?|ounces?|oz|counts?|ct|packs?|pk|pieces?|pcs?|each|ea|l|g";

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number): string {
  return `$${rounded(value).toFixed(2)}`;
}

/**
 * Lowercase and rewrite half-gallon, dozen, fractions, and fluid ounces
 * into a single number + unit the matcher can read.
 */
export function normalizeSizeText(text: string): string {
  let value = text
    .toLowerCase()
    .replace(/½/g, "1/2")
    .replace(/¼/g, "1/4")
    .replace(/¾/g, "3/4")
    .replace(/⅓/g, "1/3")
    .replace(/⅔/g, "2/3");

  value = value
    .replace(/fluid\s+ounces?\b/g, "floz")
    .replace(/fl\.?\s*oz\b/g, "floz");

  value = value
    .replace(/\bhalf[\s-]*(?:gallons?|gal)\b/g, "0.5 gal")
    .replace(/\bhalf[\s-]*dozens?\b/g, "6 ct");

  value = value.replace(/\b(\d+(?:\.\d+)?)\s*dozens?\b/g, (_, raw: string) => {
    return `${Number(raw) * 12} ct`;
  });
  value = value.replace(/(?<![\d.])(?<!\d\s)\bdozens?\b/g, "12 ct");

  value = value.replace(/(\d+)\s*\/\s*(\d+)/g, (_, num: string, den: string) => {
    const denominator = Number(den);
    if (!Number.isFinite(denominator) || denominator === 0) {
      return `${num}/${den}`;
    }
    return String(Number(num) / denominator);
  });

  value = value
    .replace(/(?<![\d.])(?<!\d\s)\bgallons?\b/g, "1 gal")
    .replace(/(?<![\d.])(?<!\d\s)\bquarts?\b/g, "1 qt")
    .replace(/(?<![\d.])(?<!\d\s)\bpints?\b/g, "1 pt");

  value = value.replace(/(\d)\s*-\s*(?=[a-z])/g, "$1 ");
  return value.replace(/\s+/g, " ").trim();
}

function fromUnit(qty: number, unitRaw: string): Measure | null {
  if (!Number.isFinite(qty) || qty <= 0) {
    return null;
  }

  const unit = unitRaw.toLowerCase();
  const labelQty = Number.isInteger(qty) ? String(qty) : String(rounded(qty));

  if (unit === "floz") {
    return { dimension: "volume", amount: qty, label: `${labelQty} fl oz` };
  }
  if (unit === "gal" || unit.startsWith("gallon")) {
    return { dimension: "volume", amount: qty * 128, label: `${labelQty} gal` };
  }
  if (unit === "qt" || unit.startsWith("quart")) {
    return { dimension: "volume", amount: qty * 32, label: `${labelQty} qt` };
  }
  if (unit === "pt" || unit.startsWith("pint")) {
    return { dimension: "volume", amount: qty * 16, label: `${labelQty} pt` };
  }
  if (unit === "l" || unit.startsWith("liter") || unit.startsWith("litre")) {
    return { dimension: "volume", amount: qty * FL_OZ_PER_LITER, label: `${labelQty} L` };
  }
  if (unit === "ml" || unit.startsWith("milliliter") || unit.startsWith("millilitre")) {
    return {
      dimension: "volume",
      amount: qty * (FL_OZ_PER_LITER / 1000),
      label: `${labelQty} ml`,
    };
  }
  if (unit === "lb" || unit === "lbs" || unit.startsWith("pound")) {
    return { dimension: "weight", amount: qty * 16, label: `${labelQty} lb` };
  }
  if (unit === "oz" || unit.startsWith("ounce")) {
    return { dimension: "weight", amount: qty, label: `${labelQty} oz` };
  }
  if (unit === "kg" || unit.startsWith("kilogram")) {
    return { dimension: "weight", amount: qty * OZ_PER_KG, label: `${labelQty} kg` };
  }
  if (unit === "g" || unit.startsWith("gram")) {
    return { dimension: "weight", amount: qty * (OZ_PER_KG / 1000), label: `${labelQty} g` };
  }

  const packWord = unit === "pk" || unit.startsWith("pack");
  if (
    packWord ||
    unit === "ct" ||
    unit.startsWith("count") ||
    unit === "pc" ||
    unit === "pcs" ||
    unit.startsWith("piece") ||
    unit === "ea" ||
    unit === "each"
  ) {
    return {
      dimension: "count",
      amount: qty,
      label: `${labelQty} ct`,
      packWord,
    };
  }

  return null;
}

function measuresIn(text: string): Measure[] {
  const pattern = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALTERNATION})\\b`, "gi");
  const found: Measure[] = [];
  for (const match of text.matchAll(pattern)) {
    const measure = fromUnit(Number(match[1]), match[2] ?? "");
    if (measure) {
      found.push(measure);
    }
  }
  return found;
}

/**
 * Pulls a package size out of a title or retailer size field.
 * Returns null when the text has no measurable amount.
 */
export function parsePackageSize(text?: string | null): ParsedPackageSize | null {
  if (!text?.trim()) {
    return null;
  }

  const normalized = normalizeSizeText(text);
  const multi = normalized.match(
    new RegExp(
      `(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALTERNATION})\\b`,
      "i"
    )
  );
  if (multi?.[1] && multi[2] && multi[3]) {
    const measure = fromUnit(Number(multi[1]) * Number(multi[2]), multi[3]);
    if (measure) {
      return measure;
    }
  }

  const packOf = normalized.match(
    new RegExp(
      `(\\d+(?:\\.\\d+)?)\\s*(?:packs?|pk)\\s*(?:of\\s+)?(\\d+(?:\\.\\d+)?)\\s*(${UNIT_ALTERNATION})\\b`,
      "i"
    )
  );
  if (packOf?.[1] && packOf[2] && packOf[3] && !/^(?:packs?|pk|counts?|ct)$/i.test(packOf[3])) {
    const measure = fromUnit(Number(packOf[1]) * Number(packOf[2]), packOf[3]);
    if (measure) {
      return measure;
    }
  }

  const measures = measuresIn(normalized);
  if (measures.length === 0) {
    return null;
  }

  const physical = measures.filter((measure) => measure.dimension !== "count");
  const counts = measures.filter((measure) => measure.dimension === "count");
  if (physical.length > 0) {
    const pack = counts.find((measure) => measure.packWord && measure.amount > 1);
    const primary = physical[0];
    if (pack && primary) {
      return {
        dimension: primary.dimension,
        amount: primary.amount * pack.amount,
        label: `${pack.amount} x ${primary.label}`,
      };
    }
    return primary ?? null;
  }

  return counts[0] ?? null;
}

const STRIP_UNIT =
  "fl\\.?\\s*oz|fluid\\s+ounces?|floz|gallons?|gal|quarts?|qt|pints?|pt|milliliters?|ml|liters?|litres?|kilograms?|kg|grams?|pounds?|lbs?|ounces?|oz|counts?|ct|packs?|pk|pieces?|pcs?|each|ea|dozens?|l|g";

/**
 * Removes measurable size phrases so "1 gallon of milk" can match a product
 * titled "Whole Milk". Leaves the rest of the words, including their case.
 */
export function stripPackageSizePhrases(text: string): string {
  let value = text
    .replace(/½/g, "1/2")
    .replace(/¼/g, "1/4")
    .replace(/¾/g, "3/4")
    .replace(/⅓/g, "1/3")
    .replace(/⅔/g, "2/3");

  const patterns = [
    new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*[x×]\\s*\\d+(?:\\.\\d+)?\\s*(?:${STRIP_UNIT})\\b`, "gi"),
    /\bhalf[\s-]*(?:gallons?|gal)\b/gi,
    /\bhalf[\s-]*dozens?\b/gi,
    new RegExp(`\\b\\d+\\s*\\/\\s*\\d+\\s*(?:${STRIP_UNIT})\\b`, "gi"),
    new RegExp(`\\b\\d+(?:\\.\\d+)?\\s*-?\\s*(?:${STRIP_UNIT})\\b`, "gi"),
    /\b(?:gallons?|quarts?|pints?|dozens?)\b/gi,
  ];

  for (const pattern of patterns) {
    value = value.replace(pattern, " ");
  }

  return value.replace(/\s+/g, " ").trim();
}

/**
 * Shopper-facing unit price.
 * Volume at least a quart is shown per gallon so milk sizes compare at a glance.
 * Weight at least a pound is shown per pound. Counts are per item.
 */
export function formatUnitPrice(
  price: number,
  size: ParsedPackageSize
): { unitPrice: number; unitPriceText: string } | null {
  if (!Number.isFinite(price) || price < 0 || size.amount <= 0) {
    return null;
  }

  let per: number;
  let suffix: string;
  if (size.dimension === "count") {
    per = price / size.amount;
    suffix = "/ct";
  } else if (size.dimension === "volume") {
    if (size.amount >= 32) {
      per = price / (size.amount / 128);
      suffix = "/gal";
    } else {
      per = price / size.amount;
      suffix = "/fl oz";
    }
  } else if (size.amount >= 16) {
    per = price / (size.amount / 16);
    suffix = "/lb";
  } else {
    per = price / size.amount;
    suffix = "/oz";
  }

  const unitPrice = rounded(per);
  return { unitPrice, unitPriceText: `${money(unitPrice)}${suffix}` };
}
