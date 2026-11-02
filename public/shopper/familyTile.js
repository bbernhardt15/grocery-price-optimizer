/**
 * Shopper-facing labels for a product family tile.
 * The list shows the family (Coca-Cola, Doritos Cool Ranch) plus the
 * size the shopper picked (12 pk · 12 fl oz cans). The catalog id stays
 * the variant's master product id.
 */

/**
 * @param {{ familyName?: string, name?: string, brand?: string, variantLabel?: string, sizeLabel?: string } | null | undefined} product
 * @returns {{ title: string, detail: string }}
 */
function cleanLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeLabel(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shoutingWord(word) {
  const letters = word.replace(/[^A-Za-z]/g, "");
  return letters.length >= 4 && letters === letters.toUpperCase();
}

function soften(value) {
  return value.replace(/[A-Za-z0-9][A-Za-z0-9']*/g, (word) => {
    if (!shoutingWord(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

/**
 * Drop a brand that is repeated at the front of a name, and quiet
 * ALL CAPS brand tokens. "Gerber Gerber Juice" and "GERBER Pear juice"
 * both read as Gerber products. Mixed-case names stay as written.
 * @param {string | null | undefined} name
 * @param {string | null | undefined} [brand]
 */
export function displayProductName(name, brand) {
  let title = cleanLabel(name);
  if (!title) return "";
  const brandClean = cleanLabel(brand);
  if (!brandClean) return soften(title);
  const boundary = new RegExp(`^${escapeLabel(brandClean)}(?=\\s|$)`, "i");
  let rest = title;
  let count = 0;
  while (boundary.test(rest) && count < 4) {
    count += 1;
    rest = rest.replace(boundary, "").trim();
  }
  if (count >= 1) title = `${soften(brandClean)} ${soften(rest)}`.trim();
  else title = soften(title);
  return title.replace(/\s+/g, " ").trim();
}

const PACKAGING = new Set("jug jugs plastic bottle bottles bag bags box boxes carton cartons can cans pouch container gallon jug sleeve sleeves wrapper".split(" "));
const DROP_WORDS = new Set("of a an the bunch using made from with real quality premium style recipe over hardwood mesquite".split(" "));
const TYPE_WORDS = ["gelato", "ice cream", "yogurt", "cereal", "juice"];
const SIZE_SOURCE = "\\b\\d+(?:\\.\\d+)?\\s*(?:fl\\.?\\s*oz|fluid\\s+ounces?|oz|ounces?|lb|lbs|pounds?|g|kg|ml|l|pt|pints?|gal|gallons?|ct|count)\\b";

function sizePattern(flags) {
  return new RegExp(SIZE_SOURCE, flags);
}

/**
 * Shopper-facing title: brand, product, and size.
 * Duplicated words, stray punctuation, and marketing claims stay off the row.
 * The full retailer title is what a tap reveals.
 * @param {{ name?: string, brand?: string, size?: string, familyName?: string } | null | undefined} item
 */
export function shortProductTitle(item) {
  const brand = cleanLabel(item?.brand);
  const family = cleanLabel(item?.familyName);
  let size = prettySize(item?.size);
  let title = strayPunctuation(cleanLabel(item?.name));
  if (!title && !family) return "";
  title = stripMarketing(title);
  if (!size) {
    const found = title.match(sizePattern("gi"));
    if (found?.length) size = prettySize(found[found.length - 1]);
  }
  title = title.replace(sizePattern("gi"), " ");
  title = title.replace(/\b1\s*(?:count|ct)\b/gi, " ");
  if (brand) title = title.replace(new RegExp(escapeLabel(brand), "ig"), " ");
  title = collapsePhrases(title);
  const words = [];
  const seen = new Set();
  for (const word of title.split(/\s+/)) {
    const token = word.toLowerCase().replace(/[^a-z0-9']/g, "");
    if (!token || DROP_WORDS.has(token) || PACKAGING.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    words.push(word.replace(/^[,.-]+|[,.-]+$/g, ""));
  }
  let product = soften(words.filter(Boolean).join(" "));
  product = moveTypeWord(product);
  if (!product && family) product = soften(family);
  if (/^fresh\b/i.test(product) && product.split(/\s+/).length <= 3) product = product.replace(/^fresh\s+/i, "");
  const showBrand = brand && !/^fresh$/i.test(brand) && !product.toLowerCase().includes(brand.toLowerCase());
  let text = [showBrand ? soften(brand) : "", product].filter(Boolean).join(" ");
  text = collapsePhrases(text);
  if (size && !text.toLowerCase().includes(size.toLowerCase())) text = `${text}, ${size}`;
  text = strayPunctuation(text).replace(/\s+,/g, ",").replace(/^[,\s]+|[,\s]+$/g, "");
  return capTitle(text, 56);
}

function prettySize(value) {
  let size = cleanLabel(value);
  if (!size) return "";
  size = size.replace(/\b1\s*(?:count|ct)\b/gi, " ");
  size = size.replace(/\bpints?\b/gi, "pt");
  size = size.replace(/\bpounds?\b/gi, "lb");
  size = size.replace(/\bounces?\b/gi, "oz");
  size = size.replace(/\bgallons?\b/gi, "gal");
  size = size.replace(/\bfluid\s+/gi, "fl ");
  size = size.replace(/\s+/g, " ").trim().replace(/^[,.-]+|[,.-]+$/g, "");
  const match = size.match(sizePattern("i"));
  return match ? match[0].replace(/\s+/g, " ").trim() : size;
}

function stripMarketing(value) {
  return value
    .replace(/\bnon[-\s]?gmo\b/gi, " ")
    .replace(/\bgluten[-\s]?free\b/gi, " ")
    .replace(/\bfat[-\s]?free\b/gi, " ")
    .replace(/\bsugar[-\s]?free\b/gi, " ")
    .replace(/\bno\s+sugar\s+added\b/gi, " ")
    .replace(/\bfrozen\s+dessert\b/gi, " ")
    .replace(/\bhormone[-\s]?free\b/gi, " ")
    .replace(/\brbst\b/gi, " ")
    .replace(/\bantibiotic[-\s]?free\b/gi, " ")
    .replace(/\bcage[-\s]?free\b/gi, " ")
    .replace(/\bpasture[-\s]?raised\b/gi, " ")
    .replace(/\bgrass[-\s]?fed\b/gi, " ")
    .replace(/\ball[-\s]?natural\b/gi, " ")
    .replace(/\b100\s*%/gi, " ")
    .replace(/\bslow[-\s]?cooked\b/gi, " ")
    .replace(/\bsmoked\s+over\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function strayPunctuation(value) {
  return String(value || "")
    .replace(/\s*[-–—]+\s*,/g, " ")
    .replace(/,\s*[-–—]+/g, " ")
    .replace(/\s+[-–—]+\s+/g, " ")
    .replace(/\s+[-–—,]+$/g, "")
    .replace(/^[-–—,]+\s*/g, "")
    .replace(/,{2,}/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function collapsePhrases(value) {
  let words = String(value || "").split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    for (let size = Math.min(4, Math.floor(words.length / 2)); size >= 2; size -= 1) {
      const seen = new Map();
      const drop = new Set();
      for (let index = 0; index <= words.length - size; index += 1) {
        const phrase = words
          .slice(index, index + size)
          .map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""))
          .join(" ");
        if (!phrase.trim()) continue;
        if (seen.has(phrase)) {
          for (let mark = index; mark < index + size; mark += 1) drop.add(mark);
        } else seen.set(phrase, index);
      }
      if (drop.size) {
        words = words.filter((_, index) => !drop.has(index));
        changed = true;
        break;
      }
    }
  }
  return words.join(" ");
}

function moveTypeWord(product) {
  const words = product.split(/\s+/).filter(Boolean);
  if (words.length < 2) return product;
  for (const type of TYPE_WORDS) {
    const parts = type.split(" ");
    for (let index = 0; index <= words.length - parts.length; index += 1) {
      const slice = words.slice(index, index + parts.length).map((word) => word.toLowerCase());
      if (slice.join(" ") !== type) continue;
      if (index + parts.length === words.length) return product;
      const next = words.slice(0, index).concat(words.slice(index + parts.length), words.slice(index, index + parts.length));
      return next.join(" ");
    }
  }
  return product;
}

function capTitle(text, limit) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const size = clean.match(/,\s*[^,]+$/)?.[0] || "";
  let body = size ? clean.slice(0, clean.length - size.length).trim() : clean;
  const words = body.split(/\s+/);
  while (words.length > 2 && `${words.join(" ")}${size}`.length > limit) words.pop();
  body = words.join(" ");
  const next = `${body}${size}`.replace(/\s+/g, " ").trim();
  return next.length > limit ? `${next.slice(0, limit - 1).trim()}…` : next;
}

export function listItemTitle(product) {
  const raw = String(product?.familyName || product?.name || "Item").trim() || "Item";
  const title = displayProductName(raw, product?.brand) || "Item";
  const variant = String(product?.variantLabel || product?.sizeLabel || "").trim();
  const brand = String(product?.brand || "").trim();
  const showBrand = brand.length > 0 && !title.toLowerCase().includes(brand.toLowerCase());
  const detail = [showBrand ? displayProductName(brand, brand) : "", variant].filter((part) => part.length > 0).join(" · ");
  return { title, detail };
}

/**
 * Quantity staged on a tile before Add. Stays in 1–99.
 * @param {number | string | null | undefined} current
 * @param {number} delta
 */
export function stagedQuantity(current, delta) {
  const base = Number(current);
  const start = Number.isFinite(base) && base >= 1 ? Math.floor(base) : 1;
  const step = Number.isFinite(delta) ? delta : 0;
  return Math.min(99, Math.max(1, start + step));
}
