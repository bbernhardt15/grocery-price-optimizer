/**
 * Order catalog search hits for this shopper.
 * Purchase history, brand rules, and usuals come first.
 * Then the best price, with common store brands ahead of a tie.
 * Premium specialty brands stay later unless this shopper chose them.
 */

export type RankItem = {
  id?: string;
  name?: string;
  familyName?: string;
  brand?: string;
  storeBrand?: boolean;
  price?: number;
  priceFrom?: number;
  bestPrice?: number;
  bestOffer?: { price?: number };
  offers?: Array<{ price?: number }>;
  variants?: RankItem[];
};

export type RankPreference = {
  family?: string;
  mode?: string;
  brand?: string;
  brands?: string[];
  productId?: string;
};

export type RankMemory = {
  name?: string;
  brand?: string;
};

export type RankContext = {
  query?: string;
  family?: string;
  preferences?: RankPreference[];
  usuals?: RankMemory[];
  history?: RankMemory[];
};

const HOUSE = [
  "great value",
  "marketside",
  "equate",
  "parent's choice",
  "parents choice",
  "kroger",
  "simple truth",
  "private selection",
  "good & gather",
  "good and gather",
  "market pantry",
  "up & up",
  "up and up",
  "favorite day",
  "friendly farms",
  "kirkwood",
  "goldhen",
  "earthly grains",
  "reggano",
  "countryside creamery",
  "millville",
  "clancy's",
  "clancys",
  "specially selected",
  "l'oven fresh",
  "member's mark",
  "members mark",
];

const SPECIALTY = [
  "fairlife",
  "organic valley",
  "horizon",
  "lactaid",
  "vital farms",
  "eggland",
  "kerrygold",
  "dave's killer",
  "daves killer",
  "applegate",
  "boar's head",
  "boars head",
  "plugra",
  "maple hill",
  "oatly",
  "califia",
];

function fold(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function brandText(item: RankItem): string {
  return fold(`${item?.brand || ""} ${item?.name || ""} ${item?.familyName || ""}`);
}

export function isCommonStoreBrand(item: RankItem | null | undefined): boolean {
  if (!item) return false;
  if (item.storeBrand === true) return true;
  const brand = fold(item.brand);
  if (brand.length < 3) return false;
  return HOUSE.some((name) => {
    const house = fold(name);
    return brand.includes(house) || house.includes(brand);
  });
}

export function isSpecialtyBrand(item: RankItem | null | undefined): boolean {
  const text = brandText(item || {});
  if (!text) return false;
  return SPECIALTY.some((name) => text.includes(fold(name)));
}

export function itemShelfPrice(item: RankItem | null | undefined): number {
  const prices: number[] = [];
  const push = (value: unknown) => {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) prices.push(amount);
  };
  if (!item) return Number.POSITIVE_INFINITY;
  push(item.bestPrice);
  push(item.bestOffer?.price);
  push(item.price);
  push(item.priceFrom);
  for (const offer of item.offers || []) push(offer?.price);
  for (const variant of item.variants || []) {
    const nested = itemShelfPrice(variant);
    if (Number.isFinite(nested)) prices.push(nested);
  }
  if (!prices.length) return Number.POSITIVE_INFINITY;
  return Math.min(...prices);
}

function includesBrand(item: RankItem, brand: unknown): boolean {
  const wanted = fold(brand);
  if (wanted.length < 3) return false;
  const have = fold(item?.brand);
  if (have.length >= 3 && (have.includes(wanted) || wanted.includes(have))) return true;
  return brandText(item).includes(wanted);
}

function includesName(item: RankItem, name: unknown): boolean {
  const wanted = fold(name);
  if (wanted.length < 3) return false;
  const text = brandText(item);
  if (!text) return false;
  if (text.includes(wanted)) return true;
  const tokens = wanted.split(" ").filter((token) => token.length > 2);
  return tokens.length > 0 && tokens.every((token) => text.includes(token));
}

function preferenceApplies(pref: RankPreference, family: string): boolean {
  const row = String(pref?.family || "").trim();
  if (!row || !family) return true;
  return row === family;
}

export type PersonalKind = "" | "preference" | "history" | "usual";

export function personalKind(item: RankItem, context: RankContext = {}): PersonalKind {
  const family = String(context.family || "").trim();
  for (const pref of context.preferences || []) {
    if (!pref || pref.mode === "never" || pref.mode === "skip" || pref.mode === "cheapest") continue;
    if (!preferenceApplies(pref, family)) continue;
    if (pref.mode === "storeBrand" && isCommonStoreBrand(item)) return "preference";
    if (pref.productId && item.id && pref.productId === item.id) return "preference";
    const brands = [...(pref.brands || []), pref.brand].filter(Boolean);
    if (brands.some((brand) => includesBrand(item, brand))) return "preference";
  }
  for (const row of context.history || []) {
    if (row?.brand && includesBrand(item, row.brand) && (!row.name || includesName(item, row.name))) return "history";
    if (!row?.brand && row?.name && includesName(item, row.name)) return "history";
  }
  for (const row of context.usuals || []) {
    if (row?.brand && includesBrand(item, row.brand) && (!row.name || includesName(item, row.name))) return "usual";
    if (!row?.brand && row?.name && includesName(item, row.name)) return "usual";
  }
  return "";
}

const PERSONAL_ORDER: Record<PersonalKind, number> = {
  preference: 0,
  history: 1,
  usual: 2,
  "": 3,
};

function tierOf(item: RankItem, context: RankContext): number {
  if (personalKind(item, context)) return 0;
  if (isSpecialtyBrand(item)) return 2;
  return 1;
}

/** Stable order: personal, then price and store brands, then specialty and the rest. */
export function rankSearchResults<T extends RankItem>(items: T[] | null | undefined, context: RankContext = {}): T[] {
  return (items || [])
    .map((item, index) => ({
      item,
      index,
      tier: tierOf(item, context),
      personal: personalKind(item, context),
      price: itemShelfPrice(item),
      store: isCommonStoreBrand(item) ? 0 : 1,
    }))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        PERSONAL_ORDER[a.personal] - PERSONAL_ORDER[b.personal] ||
        a.price - b.price ||
        a.store - b.store ||
        a.index - b.index
    )
    .map((row) => row.item);
}
