const buckets = new Map<string, number[]>();

export function resetRateLimits(): void {
  buckets.clear();
}

/** True when the call is still inside the window. */
export function allowRate(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (buckets.get(key) || []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}
