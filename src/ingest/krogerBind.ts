/** Compare a catalog row with a Kroger name-search hit. Punctuation and case do not matter. */
export function normalizeKrogerLabel(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const COMMODITY_DEPARTMENT = new Set(["produce", "meat-seafood", "bakery"]);
/** Words that do not change which product it is. Organic, size, and trim are not noise. */
const COMMODITY_NOISE = new Set([
  "fresh",
  "the",
  "and",
  "each",
  "approx",
  "approximately",
  "lb",
  "lbs",
  "oz",
  "ct",
  "bag",
  "bunch",
  "loaf",
  "pk",
  "pack",
]);

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("oes")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/**
 * Significant words on a produce, meat, or bakery name.
 * A quantity such as "3 lb" is dropped. A lean percentage such as "93" stays.
 * Organic, large/medium/small, and cut or trim words stay, so both sides must carry them.
 */
function commodityTokens(name: string): string[] {
  let text = normalizeKrogerLabel(name).replace(/\bbone in\b/g, "bonein");
  text = text.replace(/\b\d+(?:\.\d+)?\s*(?:lb|lbs|oz|ct|pk|pack)\b/g, " ");
  return text
    .split(/\s+/)
    .map(stemToken)
    .filter((token) => token && !COMMODITY_NOISE.has(token));
}

/**
 * Produce, meat, and bakery may ignore brand, but the products have to be the same item.
 * Extra Kroger words are allowed only when they are noise (fresh, each, a unit, loaf).
 * Organic must match organic. A size, cut, trim, or lean percentage on either side
 * has to be on the other side too.
 */
export function krogerCommodityBinds(catalogName: string, recordName: string): boolean {
  const left = commodityTokens(catalogName);
  const right = commodityTokens(recordName);
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
  const seen = new Set(right);
  return left.every((token) => seen.has(token));
}

/**
 * A term hit may use a different product id than the Walmart UPC we stored.
 * Packaged goods bind only when the brand and the full name are the same, so
 * a sharper cheddar or a homestyle wedge does not inherit another size's price.
 * Produce, meat, and bakery may bind on the commodity name.
 */
export function krogerTermBinds(
  catalog: { name: string; brand?: string; departmentId?: string },
  record: { name: string; brand?: string }
): boolean {
  const nameA = normalizeKrogerLabel(catalog.name);
  const nameB = normalizeKrogerLabel(record.name);
  const brandA = normalizeKrogerLabel(catalog.brand);
  const brandB = normalizeKrogerLabel(record.brand);
  if (brandA && brandA === brandB && nameA && nameA === nameB) return true;
  const department = catalog.departmentId?.trim().toLowerCase() ?? "";
  if (!COMMODITY_DEPARTMENT.has(department)) return false;
  return krogerCommodityBinds(catalog.name, record.name);
}
