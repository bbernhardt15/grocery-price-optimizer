/**
 * Stream a usable plan before every line of a long list has a live price.
 * The first screenful, then every batch, then the store when it finishes.
 */
export function shouldStreamSnapshot(checked: number, total: number): boolean {
  const done = Math.floor(Number(checked) || 0);
  const all = Math.floor(Number(total) || 0);
  if (done <= 0 || all <= 0) return false;
  if (done >= all) return true;
  if (done === 8) return true;
  return done % 16 === 0;
}
