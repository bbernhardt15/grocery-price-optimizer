/** Compare a catalog row with a Kroger name-search hit. Punctuation and case do not matter. */
export function normalizeKrogerLabel(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const COMMODITY_DEPARTMENT = new Set(["produce", "meat-seafood", "bakery"]);
const COMMODITY_SKIP = new Set([
  "fresh",
  "organic",
  "the",
  "and",
  "with",
  "lb",
  "lbs",
  "oz",
  "ct",
  "each",
  "approx",
  "large",
  "medium",
  "small",
  "bag",
  "bunch",
]);
/** A prepared food the commodity itself did not name. "Bananas" is not banana bread. */
const PREPARED_FOOD = new Set(["bread", "chip", "chips", "juice", "sauce", "soup", "pie", "cake", "cookie", "muffin", "yogurt", "cereal", "nugget", "nuggets"]);

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("oes")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function commodityTokens(name: string): string[] {
  return normalizeKrogerLabel(name)
    .split(" ")
    .map(stemToken)
    .filter((token) => token && !COMMODITY_SKIP.has(token) && !/^\d+$/.test(token));
}

/**
 * Produce, meat, and bakery often use a different brand and a shorter name
 * at Kroger than the Walmart row. Every catalog word still has to be on the
 * Kroger item, and a prepared food the catalog did not name does not count.
 */
export function krogerCommodityBinds(catalogName: string, recordName: string): boolean {
  const left = commodityTokens(catalogName);
  const right = new Set(commodityTokens(recordName));
  if (left.length === 0 || right.size === 0) return false;
  if (left.some((token) => !right.has(token))) return false;
  for (const prepared of PREPARED_FOOD) {
    if (right.has(prepared) && !left.includes(prepared)) return false;
  }
  return true;
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
