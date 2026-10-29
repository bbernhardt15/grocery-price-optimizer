/**
 * Taste profile stored on the account list.
 * Absent on a write means leave the saved profile alone.
 * Prices and store names are not part of the profile.
 */

const MAX_BYTES = 80_000;

export type TastePreference = {
  family: string;
  catalogId: string;
  upc: string;
  brand: string;
  name: string;
  sizeLabel: string;
  imageUrl: string;
  locked: boolean;
  source: string;
  updatedAt: number;
};

export type TasteProfile = {
  version: number;
  updatedAt: number;
  onboarding: { status: string; step: string; updatedAt: number };
  why: string[];
  household: { size: number | null; kids: boolean | null; picky: boolean | null };
  loves: string[];
  avoids: string[];
  cuisines: Record<string, "like" | "dislike">;
  allergies: string[];
  diets: string[];
  always: string[];
  never: string[];
  mustHaves: string[];
  brand: { default: string | null; organicIfClose: boolean; overrides: Record<string, string> };
  style: { shopping: string | null; cooking: string | null; time: string | null };
  productPreferences: Record<string, TastePreference>;
  categoryPreferences: Record<string, TasteCategoryPreference>;
  neverProducts: Array<{ family: string; catalogId: string; upc: string; brand: string; name: string; updatedAt: number }>;
  askedLock: Record<string, string>;
};

export type TasteCategoryPreference = {
  family: string;
  mode: string;
  brand: string;
  productId: string;
  size: string;
  attributes: string[];
  updatedAt: number;
};

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function stamp(value: unknown): number {
  const number = typeof value === "number" ? value : 0;
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(Math.floor(number), 9e15);
}

/** Accept a profile object or leave it absent. A bad object is an error so a list write can say why. */
export function parseTasteProfile(value: unknown): TasteProfile | { error: string } | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return { error: "tasteProfile must be an object." };
  let encoded = "";
  try {
    encoded = JSON.stringify(value);
  } catch {
    return { error: "tasteProfile must be an object." };
  }
  if (encoded.length > MAX_BYTES) return { error: "tasteProfile is too large." };
  const row = value as Record<string, unknown>;
  if ("price" in row || "storeName" in row) return { error: "tasteProfile cannot include a price or a store." };
  const prefs: TasteProfile["productPreferences"] = {};
  const source = row.productPreferences;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [key, entry] of Object.entries(source as Record<string, unknown>).slice(0, 40)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const pref = entry as Record<string, unknown>;
      if ("price" in pref || "storeName" in pref) return { error: "tasteProfile cannot include a price or a store." };
      const family = clean(pref.family || key, 40).toLowerCase();
      const name = clean(pref.name, 120);
      if (!/^[a-z0-9-]{2,40}$/.test(family) || !name) continue;
      const catalogId = clean(pref.catalogId, 80);
      prefs[family] = {
        family,
        catalogId: /^[A-Za-z0-9:_-]{1,80}$/.test(catalogId) ? catalogId : "",
        upc: clean(pref.upc, 20).replace(/\D/g, ""),
        brand: clean(pref.brand, 80),
        name,
        sizeLabel: clean(pref.sizeLabel, 80),
        imageUrl: clean(pref.imageUrl, 240),
        locked: pref.locked === true,
        source: clean(pref.source, 20) || "manual",
        updatedAt: stamp(pref.updatedAt),
      };
    }
  }
  const copy = JSON.parse(encoded) as TasteProfile;
  const categories: TasteProfile["categoryPreferences"] = {};
  const categorySource = row.categoryPreferences;
  if (categorySource && typeof categorySource === "object" && !Array.isArray(categorySource)) {
    for (const [key, entry] of Object.entries(categorySource as Record<string, unknown>).slice(0, 40)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const pref = entry as Record<string, unknown>;
      if ("price" in pref || "storeName" in pref) return { error: "tasteProfile cannot include a price or a store." };
      const family = clean(pref.family || key, 40).toLowerCase();
      const mode = clean(pref.mode, 20);
      if (!/^[a-z0-9-]{2,40}$/.test(family) || !["brand", "storeBrand", "cheapest", "skip", "never"].includes(mode)) continue;
      const productId = clean(pref.productId, 80);
      const attributes = Array.isArray(pref.attributes)
        ? pref.attributes.map((item) => clean(item, 40).toLowerCase()).filter(Boolean).slice(0, 8)
        : [];
      categories[family] = {
        family,
        mode,
        brand: clean(pref.brand, 80),
        productId: /^[A-Za-z0-9:_-]{1,80}$/.test(productId) ? productId : "",
        size: clean(pref.size, 80),
        attributes,
        updatedAt: stamp(pref.updatedAt),
      };
    }
  }
  copy.version = 1;
  copy.updatedAt = stamp(row.updatedAt);
  copy.productPreferences = prefs;
  copy.categoryPreferences = categories;
  return copy;
}

export function mergeTasteProfiles(base: unknown, incoming: unknown): TasteProfile | undefined {
  const left = parseTasteProfile(base);
  const right = parseTasteProfile(incoming);
  const local = left && !("error" in left) ? left : null;
  const remote = right && !("error" in right) ? right : null;
  if (!local) return remote || undefined;
  if (!remote) return local;
  const newer = remote.updatedAt >= local.updatedAt ? remote : local;
  const older = newer === remote ? local : remote;
  const productPreferences = { ...older.productPreferences };
  for (const [key, pref] of Object.entries(newer.productPreferences || {})) {
    const current = productPreferences[key];
    if (!current || pref.updatedAt > current.updatedAt || (pref.updatedAt === current.updatedAt && pref.locked && !current.locked)) {
      productPreferences[key] = pref;
    }
  }
  const categoryPreferences = { ...(older.categoryPreferences || {}) };
  for (const [key, pref] of Object.entries(newer.categoryPreferences || {})) {
    const current = categoryPreferences[key];
    if (!current || pref.updatedAt > current.updatedAt) categoryPreferences[key] = pref;
  }
  return { ...newer, productPreferences, categoryPreferences, updatedAt: Math.max(local.updatedAt, remote.updatedAt) };
}
