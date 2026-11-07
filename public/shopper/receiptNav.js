/**
 * Receipt Back inside onboarding.
 * The trip list returns to the parsed review. Reading and the review
 * return to the upload step. A browser Back that was never given a
 * history entry leaves the app; that is a separate path from this button.
 */

/** @param {string | null | undefined} phase */
export function receiptBackPhase(phase) {
  if (phase === "trip") return "learned";
  if (phase === "learned" || phase === "reading") return "upload";
  return "upload";
}

/**
 * A receipt request may open the learned screen only while it is still
 * the latest request and the shopper has not left the reading step.
 * @param {number} token
 * @param {number} current
 * @param {string | null | undefined} phase
 */
export function receiptReadCurrent(token, current, phase) {
  return token === current && phase === "reading";
}
