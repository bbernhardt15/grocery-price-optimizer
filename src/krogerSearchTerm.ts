/**
 * Kroger's Products API returns 400 when `filter.term` is a long, symbol-heavy
 * catalog title. Shopper search keeps brand plus the core name.
 */

const FILLER = new Set([
  "gluten",
  "dairy",
  "nut",
  "soy",
  "kosher",
  "free",
  "pack",
  "packs",
  "pk",
  "ounce",
  "ounces",
  "oz",
  "each",
  "count",
  "ct",
  "size",
  "fl",
  "fluid",
  "lb",
  "lbs",
  "pound",
  "pounds",
  "gal",
  "gallon",
  "ml",
  "liter",
  "litre",
  "box",
  "boxes",
  "bag",
  "bags",
  "can",
  "cans",
]);

export type KrogerTermOptions = {
  /** Meaningful words to keep. Shopper search uses 8, then retries with fewer. */
  maxWords?: number;
};

function meaningfulWords(value: string): string[] {
  let text = value.normalize("NFKC");
  const pipe = text.indexOf("|");
  if (pipe >= 0) text = text.slice(0, pipe);
  text = text
    .replace(/[®™©℠]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d{2,3}\s*-\s*\d{2,3}\s*v\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:pack|pk|ct|count|ounce|ounces|oz|fl\.?\s*oz|each|lb|lbs)\b/gi, " ")
    .replace(/[/|]+/g, " ")
    .replace(/[^\p{L}\p{N}\s'&./+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text.split(" ").filter(Boolean);
  const kept = words.filter((word, index) => {
    const lower = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!lower || /^\d+$/.test(lower)) return false;
    if (index > 0 && FILLER.has(lower)) return false;
    return true;
  });
  return kept.length ? kept : words.filter((word) => /[A-Za-z]/.test(word));
}

/**
 * Brand plus the core product name.
 * Pipes, parentheses, trademark marks, pack counts, and voltage ranges are removed.
 * The result is at most `maxWords` words (default 8) and 80 characters.
 */
export function buildKrogerSearchTerm(value: string | undefined | null, options: KrogerTermOptions = {}): string | null {
  const maxWords = Math.max(1, Math.min(8, options.maxWords ?? 8));
  const words = meaningfulWords(String(value || ""));
  if (!words.length) return null;
  const term = words.slice(0, maxWords).join(" ").slice(0, 80).trim();
  return term.length ? term : null;
}

/** One shorter retry after a 400. Null when there is nothing shorter to send. */
export function shorterKrogerSearchTerm(value: string | undefined | null, alreadySent: string): string | null {
  const primary = alreadySent.trim().toLowerCase();
  const capped = buildKrogerSearchTerm(value, { maxWords: 4 });
  if (capped && capped.toLowerCase() !== primary) return capped;
  const words = alreadySent.trim().split(/\s+/).filter(Boolean);
  if (words.length > 2) return words.slice(0, 2).join(" ");
  return null;
}
