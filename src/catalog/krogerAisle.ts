/** Aisle text from the Kroger Products API `aisleLocations` field, when the store sent one. */
export function krogerAisleLabel(product: { aisleLocations?: unknown } | null | undefined): string {
  const rows = product?.aisleLocations;
  if (!Array.isArray(rows)) return "";
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as { description?: unknown; number?: unknown };
    const description = String(record.description ?? "").trim();
    if (description) return description.slice(0, 40);
    const number = String(record.number ?? "").trim();
    if (number) return `Aisle ${number}`.slice(0, 40);
  }
  return "";
}
