/**
 * Flyer `current_price` is sometimes a number, sometimes "$2.99" / "2.99".
 * BOGO / "% off" rows with no dollar amount are skipped — we do not invent a price.
 */
export function parseFlippPrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withoutPercents = trimmed.replace(/\d+(?:\.\d+)?\s*%/g, " ").trim();
  const looksLikeBogo = /\bbogo\b/i.test(trimmed) && !/\$/.test(trimmed);
  if (looksLikeBogo || !/\$|\d/.test(withoutPercents)) {
    return null;
  }

  const match = trimmed.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}
