/**
 * Receipt import while a file is still being read.
 * A zero count before the first item looks like the read failed.
 */

export const READING_RECEIPT = "Reading your receipt...";

/**
 * @param {{ status?: string, found?: number, items?: string[], name?: string } | null | undefined} card
 * @param {(name: string, count: number) => string} [fallback]
 */
export function readCardTitle(card, fallback) {
  const found = Math.max(0, Math.floor(Number(card?.found) || 0));
  const named = (card?.items || []).map((name) => String(name || "").trim()).filter(Boolean).length;
  const status = String(card?.status || "reading");
  if ((status === "reading" || status === "pending") && found < 1 && named < 1) return READING_RECEIPT;
  const count = Math.max(found, named);
  if (typeof fallback === "function") return fallback(card?.name, count);
  const noun = count === 1 ? "item" : "items";
  return `${count} ${noun} found`;
}
