/**
 * Buy again from trips this phone has already planned, plus a few
 * starter lists. Starter entries are names to look up. They do not
 * carry prices.
 */

export const USUALS_KEY = "gg-usuals";

export const STARTER_LISTS = [
  {
    id: "weekly",
    title: "Weekly basics",
    blurb: "Fruit, milk, eggs, bread, and chicken.",
    picks: [
      { name: "Bananas", brand: "Fresh" },
      { name: "Whole Milk", brand: "Dairy Pure" },
      { name: "Large Eggs", brand: "Goldhen" },
      { name: "White Sandwich Bread", brand: "Nature's Own" },
      { name: "Boneless Chicken Breast", brand: "Just Bare" },
    ],
  },
  {
    id: "breakfast",
    title: "Breakfast",
    blurb: "Eggs, bread, cereal, oats, and juice.",
    picks: [
      { name: "Large Eggs", brand: "Goldhen" },
      { name: "White Sandwich Bread", brand: "Nature's Own" },
      { name: "Toasted Oats Cereal", brand: "General Mills" },
      { name: "Old Fashioned Oats", brand: "Quaker" },
      { name: "Orange Juice", brand: "Simply" },
    ],
  },
  {
    id: "cookout",
    title: "Cookout",
    blurb: "Beef, bread, chips, and soda.",
    picks: [
      { name: "Ground Beef 80/20", brand: "All Natural" },
      { name: "White Sandwich Bread", brand: "Nature's Own" },
      { name: "Classic Potato Chips", brand: "Lay's" },
      { name: "Coca-Cola Classic 12 Pack 12 fl oz Cans", brand: "Coca-Cola" },
    ],
  },
  {
    id: "baby",
    title: "Baby essentials",
    blurb: "Diapers and juice.",
    picks: [
      { name: "Baby Diapers Size 3", brand: "Parent's Choice" },
      { name: "Gerber Gerber Juice, 4 oz", brand: "Gerber" },
      { name: "GERBER Pear Juice, 4 fl oz", brand: "GERBER" },
    ],
  },
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function norm(value) {
  return clean(value).toLowerCase();
}

/** @param {string} id */
export function starterList(id) {
  return STARTER_LISTS.find((list) => list.id === id) || null;
}

/** @param {{ name?: string, brand?: string, catalogId?: string, id?: string }} item */
export function usualKey(item) {
  const id = clean(item?.catalogId || item?.id);
  if (id) return `id:${id}`;
  return `name:${norm(item?.brand)}:${norm(item?.name)}`;
}

/**
 * @param {{ getItem: (key: string) => string | null }} storage
 */
export function readUsuals(storage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(USUALS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row) => row && clean(row.name))
      .map((row) => ({
        name: clean(row.name),
        brand: clean(row.brand),
        catalogId: clean(row.catalogId),
        quantity: Math.max(1, Math.floor(Number(row.quantity) || 1)),
        times: Math.max(1, Math.floor(Number(row.times) || 1)),
        lastAt: Number(row.lastAt) || 0,
      }));
  } catch {
    return [];
  }
}

/**
 * Remember what this phone planned. Newest and most repeated come first.
 * Prices are not stored.
 * @param {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void }} storage
 * @param {Array<{ name?: string, brand?: string, catalogId?: string, id?: string, quantity?: number }>} items
 * @param {number} [at]
 */
export function rememberUsuals(storage, items, at = Date.now()) {
  if (!storage) return [];
  const map = new Map(readUsuals(storage).map((row) => [usualKey(row), row]));
  for (const item of items || []) {
    const name = clean(item?.name);
    if (!name) continue;
    const key = usualKey({ ...item, name });
    const prior = map.get(key);
    map.set(key, {
      name,
      brand: clean(item?.brand || prior?.brand),
      catalogId: clean(item?.catalogId || item?.id || prior?.catalogId),
      quantity: Math.max(1, Math.floor(Number(item?.quantity) || prior?.quantity || 1)),
      times: (prior?.times || 0) + 1,
      lastAt: at,
    });
  }
  const next = [...map.values()]
    .sort((a, b) => b.lastAt - a.lastAt || b.times - a.times || a.name.localeCompare(b.name))
    .slice(0, 24);
  storage.setItem(USUALS_KEY, JSON.stringify(next));
  return next;
}

function namesOf(product) {
  return [product?.name, product?.familyName, product?.catalogName].map(norm).filter(Boolean);
}

/**
 * Match a starter pick to a catalog row by name and brand.
 * The returned row is the catalog row, including its own price.
 * @param {{ name?: string, brand?: string }} pick
 * @param {Array<{ name?: string, familyName?: string, catalogName?: string, brand?: string }>} products
 */
export function matchPick(pick, products) {
  const name = norm(pick?.name);
  const brand = norm(pick?.brand);
  if (!name) return null;
  return (
    (products || []).find((product) => {
      if (!namesOf(product).includes(name)) return false;
      if (!brand) return true;
      return norm(product?.brand) === brand;
    }) || null
  );
}

/**
 * @param {{ picks?: Array<{ name?: string, brand?: string }> }} list
 * @param {Array<{ name?: string, brand?: string }>} products
 */
export function picksForList(list, products) {
  const found = [];
  const missing = [];
  for (const pick of list?.picks || []) {
    const match = matchPick(pick, products);
    if (match) found.push(match);
    else missing.push(pick);
  }
  return { found, missing };
}
