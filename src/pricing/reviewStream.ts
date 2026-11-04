import { shouldStreamSnapshot } from "./streamPlan";

/**
 * Stream a review plan as soon as the first priced item from a store is
 * in hand, then on the same cadence as the rest of the price pass.
 * `shouldStreamSnapshot` stays as it is for callers that already depend on it.
 */
export function shouldStreamReview(checked: number, total: number): boolean {
  const done = Math.floor(Number(checked) || 0);
  const all = Math.floor(Number(total) || 0);
  if (done <= 0 || all <= 0) return false;
  if (done === 1) return true;
  return shouldStreamSnapshot(done, all);
}
