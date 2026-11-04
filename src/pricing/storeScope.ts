/**
 * Stores with a working price integration. Weekly-ad banners stay in the
 * catalog code and come back when GG_SHOW_AD_STORES=1.
 */
export const LIVE_STORES = ["Kroger", "Walmart"] as const;

export function showAdStores(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = String(env.GG_SHOW_AD_STORES || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function canonicalLive(name: string): string | null {
  const key = name.trim().toLowerCase();
  return LIVE_STORES.find((store) => store.toLowerCase() === key) || null;
}

/**
 * Plan generation store list. An empty request means the default trip.
 * With the flag off, that default is Kroger and Walmart. A saved list that
 * only names ad banners falls back to those two so the trip still prices.
 * The caller's names are returned unchanged when the flag is on.
 */
export function scopeStoreNames(stores: string[] = [], env: NodeJS.ProcessEnv = process.env): string[] {
  if (showAdStores(env)) return stores;
  const requested = stores.map((store) => String(store || "").trim()).filter(Boolean);
  if (requested.length === 0) return [...LIVE_STORES];
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const store of requested) {
    const live = canonicalLive(store);
    if (!live || seen.has(live)) continue;
    seen.add(live);
    kept.push(live);
  }
  return kept.length ? kept : [...LIVE_STORES];
}
