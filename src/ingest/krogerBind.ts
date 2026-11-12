/** Compare a catalog row with a Kroger name-search hit. Punctuation and case do not matter. */
export function normalizeKrogerLabel(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A term hit may use a different product id than the Walmart UPC we stored.
 * Bind only when the brand and the full name are the same, so a sharper cheddar
 * or a homestyle wedge does not inherit another size's price.
 */
export function krogerTermBinds(
  catalog: { name: string; brand?: string },
  record: { name: string; brand?: string }
): boolean {
  const brandA = normalizeKrogerLabel(catalog.brand);
  const brandB = normalizeKrogerLabel(record.brand);
  if (!brandA || brandA !== brandB) {
    return false;
  }
  const nameA = normalizeKrogerLabel(catalog.name);
  const nameB = normalizeKrogerLabel(record.name);
  return Boolean(nameA) && nameA === nameB;
}
