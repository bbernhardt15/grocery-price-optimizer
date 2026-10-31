/** Run async work with a fixed number of lanes. Results stay in input order. */

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const lanes = Math.max(1, Math.min(items.length, Math.floor(limit) || 1));

  async function lane(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: lanes }, () => lane()));
  return results;
}
