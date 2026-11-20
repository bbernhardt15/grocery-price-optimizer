/** A stored shelf price newer than this is still labeled as a live shelf price. */
export const LAST_SEEN_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Label for a stored shelf price older than 24 hours.
 * Null when the timestamp is missing or still inside that window.
 */
export function lastSeenPriceLabel(seenAt?: string | Date | null, now: Date = new Date()): string | null {
  if (seenAt == null || seenAt === "") return null;
  const at = seenAt instanceof Date ? seenAt.getTime() : Date.parse(String(seenAt));
  if (!Number.isFinite(at)) return null;
  const age = now.getTime() - at;
  if (age <= LAST_SEEN_FRESH_MS) return null;
  const days = Math.max(1, Math.floor(age / 86_400_000));
  const when = days === 1 ? "1 day ago" : `${days} days ago`;
  return `Last seen price, ${when}`;
}

/** Store-report sentence for cached shelf prices. Uses the real age when one is known. */
export function cachedLiveDetail(
  storeName: string,
  seenAt: Date | undefined,
  partner: boolean,
  now: Date = new Date()
): string {
  const aged = lastSeenPriceLabel(seenAt, now);
  if (!aged) {
    return partner
      ? `Using ${storeName} prices cached from a licensed partner feed (less than 24 hours old).`
      : `Using ${storeName} prices cached from a live API (less than 24 hours old).`;
  }
  const when = aged.replace(/^Last seen price, /, "");
  return partner
    ? `Using ${storeName} partner-feed prices last seen ${when}.`
    : `Using ${storeName} prices last seen ${when}.`;
}
