/** Keep the "we read your receipt" state on screen long enough to see. */

export const READ_HOLD_MS = 1200;

/**
 * @param {number} startedAt
 * @param {number} now
 * @param {number} [minimum]
 */
export function readHoldRemaining(startedAt, now, minimum = READ_HOLD_MS) {
  const start = Number(startedAt);
  const clock = Number(now);
  const min = Math.max(0, Number(minimum) || 0);
  if (!Number.isFinite(start) || !Number.isFinite(clock)) return min;
  return Math.max(0, min - (clock - start));
}

/** @param {number} count */
export function readCountLine(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n === 1 ? "Read 1 item from your receipt" : `Read ${n} items from your receipt`;
}
