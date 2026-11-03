type AisleRow = {
  description?: unknown;
  number?: unknown;
  aisleDescription?: unknown;
  aisleNumber?: unknown;
  bayNumber?: unknown;
};

function aislePools(product: { aisleLocations?: unknown; items?: unknown } | null | undefined): unknown[][] {
  const pools: unknown[][] = [];
  if (Array.isArray(product?.aisleLocations)) pools.push(product.aisleLocations);
  if (Array.isArray(product?.items)) {
    for (const item of product.items) {
      if (!item || typeof item !== "object") continue;
      const nested = (item as { aisleLocations?: unknown }).aisleLocations;
      if (Array.isArray(nested)) pools.push(nested);
    }
  }
  return pools;
}

function aisleRowLabel(row: AisleRow): string {
  const description = String(row.description ?? row.aisleDescription ?? "").trim();
  const number = String(row.number ?? row.aisleNumber ?? row.bayNumber ?? "").trim();
  if (/^aisle\b/i.test(description)) return description.slice(0, 40);
  const digits = (number || (/^\d+[a-z]?$/i.test(description) ? description : "")).replace(/[^0-9a-z]/gi, "");
  if (digits && /\d/.test(digits)) return `Aisle ${digits}`.slice(0, 40);
  if (description) return description.slice(0, 40);
  return "";
}

/**
 * Aisle text from the Kroger Products API.
 * `aisleLocations` is on the product when `filter.locationId` is set, and some
 * payloads put the same rows on each item instead.
 */
export function krogerAisleLabel(product: { aisleLocations?: unknown; items?: unknown } | null | undefined): string {
  for (const rows of aislePools(product)) {
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const label = aisleRowLabel(row as AisleRow);
      if (label) return label;
    }
  }
  return "";
}
