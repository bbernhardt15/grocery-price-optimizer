/**
 * Themed starter lists.
 *
 * A list is a set of slots (Ground beef, Soda, …). A slot remembers one
 * favorite product family for every list that uses it, plus an optional
 * per-list override. Nothing here stores a price or a store.
 *
 * Book version 1 is the first saved shape. A missing version is read as 1.
 * Newer versions keep the fields this file understands.
 */

export const BOOK_KEY = "gg-starter-book";
export const PARTY_KEY = "gg-party";
export const SWAP_KEY = "gg-favorite-swaps";
export const BOOK_VERSION = 1;
export const DEFAULT_PARTY = 4;

const PARTY_MAX = 24;
const LIST_MAX = 24;
const SLOT_MAX = 16;
const REMOVED_MAX = 24;

/** @typedef {{ catalogId?: string, familyKey?: string, familyName?: string, name?: string, brand?: string, sizeLabel?: string, updatedAt?: number }} SlotChoice */
/** @typedef {{ cleared: true, updatedAt: number }} ClearedChoice */

/**
 * People one pack is meant to cover. Quantity is ceil(people / serves).
 * @type {Record<string, { id: string, label: string, search: string, serves: number, suggested: { name: string, brand: string, sizeLabel: string } }>}
 */
export const SLOTS = {
  "ground-beef": slot("ground-beef", "Ground beef", "ground beef", 4, "Ground Beef 80/20", "All Natural", "1 lb"),
  "burger-buns": slot("burger-buns", "Burger buns", "burger buns", 8, "Sesame Burger Buns", "Martin's", "8 ct"),
  "hot-dogs": slot("hot-dogs", "Hot dogs", "hot dogs", 4, "Beef Hot Dogs", "Oscar Mayer", "15 oz"),
  "hot-dog-buns": slot("hot-dog-buns", "Hot dog buns", "hot dog buns", 8, "Hot Dog Buns", "Martin's", "8 ct"),
  chips: slot("chips", "Chips", "potato chips", 4, "Classic Potato Chips", "Lay's", "8 oz"),
  soda: slot("soda", "Soda", "coca-cola", 6, "Coca-Cola Classic 12 Pack 12 fl oz Cans", "Coca-Cola", "12 pk"),
  ketchup: slot("ketchup", "Ketchup", "ketchup", 12, "Tomato Ketchup", "Heinz", "20 oz"),
  wings: slot("wings", "Wings", "chicken wings", 4, "Chicken Wings", "Tyson", "2 lb"),
  dip: slot("dip", "Dip", "ranch dip", 6, "Ranch Dip", "Hidden Valley", "16 oz"),
  cookies: slot("cookies", "Cookies", "oreo", 6, "OREO Chocolate Sandwich Cookies", "Oreo", ""),
  bread: slot("bread", "Bread", "sandwich bread", 4, "White Sandwich Bread", "Nature's Own", "20 oz"),
  turkey: slot("turkey", "Deli turkey", "sliced turkey", 4, "Sliced Turkey Breast", "Hillshire Farm", "9 oz"),
  apples: slot("apples", "Apples", "apples", 4, "Gala Apples", "Fresh", ""),
  juice: slot("juice", "Juice", "orange juice", 4, "Orange Juice", "Simply", ""),
  yogurt: slot("yogurt", "Yogurt", "greek yogurt", 4, "Plain Greek Yogurt", "Chobani", ""),
  cake: slot("cake", "Cake", "cake mix", 8, "Vanilla Cake Mix", "Betty Crocker", "15.25 oz"),
  "ice-cream": slot("ice-cream", "Ice cream", "ice cream", 6, "Vanilla Ice Cream", "Blue Bunny", "48 fl oz"),
  plates: slot("plates", "Plates", "paper plates", 8, "Paper Plates", "Dixie", "24 ct"),
  popcorn: slot("popcorn", "Popcorn", "popcorn", 4, "Microwave Popcorn", "Orville Redenbacher", "6 ct"),
  candy: slot("candy", "Candy", "chocolate bar", 4, "Milk Chocolate Bar", "Hershey's", "1.55 oz"),
  chicken: slot("chicken", "Chicken", "chicken breast", 4, "Boneless Chicken Breast", "Just Bare", "1 lb"),
  pasta: slot("pasta", "Pasta", "spaghetti", 4, "Spaghetti Pasta", "Barilla", "16 oz"),
  spinach: slot("spinach", "Salad greens", "spinach", 4, "Baby Spinach", "Fresh", ""),
  milk: slot("milk", "Milk", "whole milk", 4, "Whole Milk", "Dairy Pure", ""),
  eggs: slot("eggs", "Eggs", "large eggs", 4, "Large Eggs", "Goldhen", ""),
  cereal: slot("cereal", "Cereal", "cereal", 6, "Toasted Oats Cereal", "General Mills", ""),
  oats: slot("oats", "Oats", "oats", 8, "Old Fashioned Oats", "Quaker", ""),
  bananas: slot("bananas", "Bananas", "bananas", 4, "Bananas", "Fresh", ""),
  coffee: slot("coffee", "Coffee", "coffee", 8, "Ground Coffee", "Folgers", ""),
  tortillas: slot("tortillas", "Tortillas", "tortillas", 4, "Flour Tortillas", "Mission", "10 ct"),
  salsa: slot("salsa", "Salsa", "salsa", 4, "Mild Salsa", "Pace", "16 oz"),
  cheese: slot("cheese", "Cheese", "cheddar", 4, "Shredded Cheddar Cheese", "Kraft", ""),
  "whole-turkey": slot("whole-turkey", "Turkey", "whole turkey", 12, "Whole Turkey", "Butterball", "12 lb"),
  stuffing: slot("stuffing", "Stuffing", "stuffing", 8, "Stuffing Mix", "Stove Top", "6 oz"),
  cranberry: slot("cranberry", "Cranberry sauce", "cranberry", 8, "Cranberry Sauce", "Ocean Spray", "14 oz"),
  potatoes: slot("potatoes", "Potatoes", "potatoes", 6, "Russet Potatoes", "Fresh", "5 lb"),
  "dinner-rolls": slot("dinner-rolls", "Dinner rolls", "dinner rolls", 6, "Dinner Rolls", "King's Hawaiian", "12 oz"),
  "green-beans": slot("green-beans", "Green beans", "green beans", 4, "Cut Green Beans", "Del Monte", "14.5 oz"),
  butter: slot("butter", "Butter", "butter", 8, "Salted Butter", "Challenge", ""),
  "pie-crust": slot("pie-crust", "Pie crust", "pie crust", 8, "Pie Crusts", "Pillsbury", "2 ct"),
  whipped: slot("whipped", "Whipped topping", "whipped topping", 8, "Whipped Topping", "Reddi-wip", "6.5 oz"),
  flour: slot("flour", "Flour", "flour", 8, "All-Purpose Flour", "Gold Medal", "5 lb"),
  sugar: slot("sugar", "Sugar", "sugar", 8, "Granulated Sugar", "Domino", "4 lb"),
  "chocolate-chips": slot("chocolate-chips", "Chocolate chips", "chocolate chips", 8, "Semi-Sweet Chocolate Chips", "Nestle", "12 oz"),
  diapers: slot("diapers", "Diapers", "diapers", 8, "Baby Diapers Size 3", "Parent's Choice", "Size 3"),
  "baby-juice": slot("baby-juice", "Baby juice", "gerber juice", 4, "Gerber Gerber Juice, 4 oz", "Gerber", "4 oz"),
};

/** Month/day windows. A window that ends before it starts wraps the new year. */
const SEASONS = {
  thanksgiving: [[10, 15], [11, 30]],
  christmas: [[11, 15], [12, 26]],
  "super-bowl": [[1, 10], [2, 15]],
  tailgate: [[8, 20], [2, 10]],
  "july-4": [[6, 15], [7, 7]],
  "memorial-day": [[5, 10], [5, 31]],
  "labor-day": [[8, 20], [9, 8]],
  "back-to-school": [[8, 1], [9, 20]],
};

export const THEMED_LISTS = [
  theme("thanksgiving", "Thanksgiving", "Turkey, stuffing, cranberry, potatoes, and pie.", "thanksgiving", ["whole-turkey", "stuffing", "cranberry", "potatoes", "dinner-rolls", "green-beans", "butter", "pie-crust", "whipped"]),
  theme("holiday-baking", "Holiday baking", "Flour, sugar, butter, eggs, and chocolate chips.", "christmas", ["flour", "sugar", "butter", "eggs", "chocolate-chips", "milk"]),
  theme("game-day", "Game day", "Wings, chips, dip, and soda.", "super-bowl", ["wings", "chips", "dip", "soda", "cookies"]),
  theme("tailgate", "Football tailgate", "Beef, buns, chips, and soda.", "tailgate", ["ground-beef", "burger-buns", "chips", "soda", "ketchup"]),
  theme("july-4", "July 4th cookout", "Hot dogs, burgers, chips, and soda.", "july-4", ["hot-dogs", "hot-dog-buns", "ground-beef", "burger-buns", "chips", "soda", "ketchup"]),
  theme("memorial-day", "Memorial Day", "Burgers, buns, chips, and soda.", "memorial-day", ["ground-beef", "burger-buns", "chips", "soda", "ketchup"]),
  theme("labor-day", "Labor Day", "Burgers, buns, chips, and soda.", "labor-day", ["ground-beef", "burger-buns", "chips", "soda", "ketchup"]),
  theme("back-to-school", "Back to school lunches", "Bread, turkey, fruit, and juice.", "back-to-school", ["bread", "turkey", "chips", "apples", "juice", "yogurt"]),
  theme("birthday", "Birthday party", "Cake, ice cream, chips, and soda.", "", ["cake", "ice-cream", "chips", "soda", "plates"]),
  theme("movie-night", "Movie night", "Popcorn, soda, and a sweet.", "", ["popcorn", "soda", "candy", "ice-cream"]),
  theme("weeknight", "Weeknight dinners", "Chicken, pasta, salad, and bread.", "", ["chicken", "pasta", "spinach", "bread", "milk"]),
  theme("breakfast", "Breakfast basics", "Eggs, bread, cereal, oats, and juice.", "", ["eggs", "bread", "cereal", "oats", "juice", "bananas", "milk", "coffee"]),
  theme("taco-night", "Taco night", "Beef, tortillas, salsa, cheese, and chips.", "", ["ground-beef", "tortillas", "salsa", "cheese", "chips"]),
  theme("cookout", "Cookout", "Beef, bread, chips, and soda.", "", ["ground-beef", "burger-buns", "chips", "soda", "ketchup"]),
  theme("weekly", "Weekly basics", "Fruit, milk, eggs, bread, and chicken.", "", ["bananas", "milk", "eggs", "bread", "chicken"]),
  theme("baby", "Baby essentials", "Diapers and juice.", "", ["diapers", "baby-juice"]),
];

function slot(id, label, search, serves, name, brand, sizeLabel) {
  return { id, label, search, serves, suggested: { name, brand, sizeLabel } };
}

function theme(id, title, blurb, season, slotIds) {
  return { id, title, blurb, season, mine: false, slots: slotIds.map((slotId) => SLOTS[slotId]).filter(Boolean) };
}

function clean(value, max = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function norm(value) {
  return clean(value, 200).toLowerCase();
}

function clampInt(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * @param {number} serves people one unit covers
 * @param {number} people
 */
export function scaleQuantity(serves, people) {
  const party = clampInt(people, 1, PARTY_MAX, DEFAULT_PARTY);
  const cover = clampInt(serves, 1, 99, 1);
  return Math.min(99, Math.max(1, Math.ceil(party / cover)));
}

export function partySize(value) {
  return clampInt(value, 1, PARTY_MAX, DEFAULT_PARTY);
}

function monthKey(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return month * 100 + day;
}

function inWindow(date, start, end) {
  const key = monthKey(date);
  const open = start[0] * 100 + start[1];
  const close = end[0] * 100 + end[1];
  if (open <= close) return key >= open && key <= close;
  return key >= open || key <= close;
}

/** @param {{ season?: string }} list @param {Date} date */
export function isInSeason(list, date) {
  const window = list?.season ? SEASONS[list.season] : null;
  if (!window || !(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  return inWindow(date, window[0], window[1]);
}

/** Seasonal lists first. Everything else stays under More lists. */
export function arrangeLists(date) {
  const featured = [];
  const more = [];
  for (const list of THEMED_LISTS) {
    if (isInSeason(list, date)) featured.push(list);
    else more.push(list);
  }
  return { featured, more };
}

export function themedList(id) {
  return THEMED_LISTS.find((list) => list.id === id) || null;
}

export function slotById(id) {
  return SLOTS[id] || null;
}

function librarySlot(row) {
  const known = slotById(row?.slotId || row?.id);
  if (known) return known;
  const id = clean(row?.slotId || row?.id, 40);
  if (!id) return null;
  const label = clean(row?.label, 40) || "Item";
  return {
    id,
    label,
    search: clean(row?.search, 60) || label,
    serves: clampInt(row?.serves, 1, 24, 4),
    suggested: {
      name: clean(row?.suggestedName, 120) || label,
      brand: clean(row?.suggestedBrand, 80),
      sizeLabel: clean(row?.suggestedSize, 80),
    },
    custom: true,
  };
}

/** @param {string} id @param {ReturnType<typeof emptyBook>} [book] */
export function listModel(id, book) {
  const themed = themedList(id);
  if (themed) return themed;
  const mine = (book?.lists || []).find((list) => list.id === id);
  if (!mine) return null;
  return {
    id: mine.id,
    title: mine.name,
    blurb: mine.slots.map((row) => librarySlot(row)?.label).filter(Boolean).slice(0, 4).join(", "),
    season: "",
    mine: true,
    order: mine.order || 0,
    slots: mine.slots.map(librarySlot).filter(Boolean),
  };
}

export function emptyBook() {
  return { version: BOOK_VERSION, favorites: {}, overrides: {}, lists: [], removed: [], nudged: false };
}

function catalogIdOk(value) {
  return /^[a-z0-9:_-]{0,80}$/i.test(value);
}

function familyKeyOk(value) {
  return /^[a-z0-9:_ |-]{0,120}$/i.test(value);
}

/** Drop prices, stores, and anything else a choice should not keep. */
export function sanitizeChoice(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value;
  if (row.cleared === true) {
    return { cleared: true, updatedAt: clampInt(row.updatedAt, 0, 9e15, 0) };
  }
  const name = clean(row.name || row.familyName, 120);
  const familyName = clean(row.familyName || row.name, 120);
  if (!name && !familyName) return null;
  const catalogId = catalogIdOk(clean(row.catalogId, 80)) ? clean(row.catalogId, 80) : "";
  const familyKey = familyKeyOk(clean(row.familyKey, 120)) ? clean(row.familyKey, 120) : "";
  return {
    catalogId,
    familyKey,
    familyName: familyName || name,
    name: name || familyName,
    brand: clean(row.brand, 80),
    sizeLabel: clean(row.sizeLabel, 80),
    updatedAt: clampInt(row.updatedAt, 0, 9e15, 0),
  };
}

function sanitizeSlotRow(value) {
  if (!value || typeof value !== "object") return null;
  const slotId = clean(value.slotId || value.id, 40).toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(slotId)) return null;
  if (SLOTS[slotId]) return { slotId };
  const label = clean(value.label, 40);
  if (!label) return null;
  return {
    slotId,
    label,
    search: clean(value.search, 60) || label,
    serves: clampInt(value.serves, 1, 24, 4),
    suggestedName: clean(value.suggestedName, 120) || label,
    suggestedBrand: clean(value.suggestedBrand, 80),
    suggestedSize: clean(value.suggestedSize, 80),
  };
}

function sanitizeList(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id, 40).toLowerCase();
  if (!/^[a-z0-9-]{8,40}$/.test(id)) return null;
  const slots = [];
  const seen = new Set();
  for (const row of Array.isArray(value.slots) ? value.slots : []) {
    const slotRow = sanitizeSlotRow(row);
    if (!slotRow || seen.has(slotRow.slotId)) continue;
    seen.add(slotRow.slotId);
    slots.push(slotRow);
    if (slots.length >= SLOT_MAX) break;
  }
  return {
    id,
    name: clean(value.name, 40) || "My list",
    updatedAt: clampInt(value.updatedAt, 0, 9e15, 0),
    order: clampInt(value.order, 0, 9999, 0),
    slots,
  };
}

function sanitizeMap(value, nested) {
  const out = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const entries = Object.entries(value).slice(0, nested ? LIST_MAX : 80);
  for (const [key, entry] of entries) {
    const id = clean(key, 40).toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(id)) continue;
    if (nested) {
      out[id] = sanitizeMap(entry, false);
      continue;
    }
    const choice = sanitizeChoice(entry);
    if (choice) out[id] = choice;
  }
  return out;
}

/** @param {unknown} raw */
export function migrateBook(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyBook();
  const row = /** @type {Record<string, unknown>} */ (raw);
  const version = clampInt(row.version, 1, 1, 1);
  const lists = [];
  const seen = new Set();
  for (const entry of Array.isArray(row.lists) ? row.lists : []) {
    const list = sanitizeList(entry);
    if (!list || seen.has(list.id)) continue;
    seen.add(list.id);
    lists.push(list);
    if (lists.length >= LIST_MAX) break;
  }
  const removed = [];
  for (const entry of Array.isArray(row.removed) ? row.removed : []) {
    if (!entry || typeof entry !== "object") continue;
    const id = clean(entry.id, 40).toLowerCase();
    if (!/^[a-z0-9-]{8,40}$/.test(id)) continue;
    removed.push({ id, writtenAt: clampInt(entry.writtenAt, 0, 9e15, 0) });
    if (removed.length >= REMOVED_MAX) break;
  }
  return {
    version,
    favorites: sanitizeMap(row.favorites, false),
    overrides: sanitizeMap(row.overrides, true),
    lists,
    removed,
    nudged: row.nudged === true,
  };
}

/**
 * @param {{ getItem: (key: string) => string | null }} storage
 */
export function readBook(storage) {
  if (!storage) return emptyBook();
  try {
    return migrateBook(JSON.parse(storage.getItem(BOOK_KEY) || "null"));
  } catch {
    return emptyBook();
  }
}

/**
 * @param {{ setItem: (key: string, value: string) => void }} storage
 * @param {ReturnType<typeof emptyBook>} book
 */
export function writeBook(storage, book) {
  if (!storage) return emptyBook();
  const next = migrateBook(book);
  storage.setItem(BOOK_KEY, JSON.stringify(next));
  return next;
}

export function readParty(storage) {
  if (!storage) return DEFAULT_PARTY;
  const raw = storage.getItem(PARTY_KEY);
  if (raw == null || raw === "") return DEFAULT_PARTY;
  return partySize(raw);
}

export function writeParty(storage, people) {
  const next = partySize(people);
  if (storage) storage.setItem(PARTY_KEY, String(next));
  return next;
}

function newer(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return (right.updatedAt || 0) >= (left.updatedAt || 0) ? right : left;
}

function mergeChoiceMaps(left, right) {
  const out = { ...left };
  for (const [key, choice] of Object.entries(right || {})) {
    out[key] = newer(out[key], choice) || choice;
  }
  return out;
}

function mergeLists(left, right, removed) {
  const map = new Map();
  for (const list of [...left, ...right]) map.set(list.id, newer(map.get(list.id), list) || list);
  const tombstones = new Map();
  for (const entry of removed) {
    const prior = tombstones.get(entry.id) || 0;
    if (entry.writtenAt >= prior) tombstones.set(entry.id, entry.writtenAt);
  }
  const lists = [];
  for (const list of map.values()) {
    const killed = tombstones.get(list.id);
    if (killed != null && killed >= list.updatedAt) continue;
    lists.push(list);
  }
  return lists.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).slice(0, LIST_MAX);
}

function mergeRemoved(left, right, lists) {
  const live = new Map(lists.map((list) => [list.id, list.updatedAt]));
  const map = new Map();
  for (const entry of [...left, ...right]) {
    const prior = map.get(entry.id);
    if (!prior || entry.writtenAt >= prior.writtenAt) map.set(entry.id, entry);
  }
  const kept = [];
  for (const entry of map.values()) {
    const updated = live.get(entry.id);
    if (updated != null && updated > entry.writtenAt) continue;
    kept.push(entry);
  }
  return kept.slice(-REMOVED_MAX);
}

/** Later write of a favorite, override, or list wins. A newer delete stays deleted. */
export function mergeBooks(base, incoming) {
  const left = migrateBook(base);
  const right = migrateBook(incoming);
  const favorites = mergeChoiceMaps(left.favorites, right.favorites);
  const overrides = { ...left.overrides };
  for (const [listId, slots] of Object.entries(right.overrides || {})) {
    overrides[listId] = mergeChoiceMaps(overrides[listId] || {}, slots);
  }
  const removed = [...left.removed, ...right.removed];
  const lists = mergeLists(left.lists, right.lists, removed);
  return {
    version: BOOK_VERSION,
    favorites,
    overrides,
    lists,
    removed: mergeRemoved(left.removed, right.removed, lists),
    nudged: left.nudged || right.nudged,
  };
}

function isChoice(value) {
  return Boolean(value && value.cleared !== true && (value.name || value.familyName));
}

/** Override, then the shared favorite, then the suggested family. */
export function activeChoice(book, listId, slotDef) {
  const override = book?.overrides?.[listId]?.[slotDef.id];
  if (isChoice(override)) return { choice: override, source: "override" };
  const favorite = book?.favorites?.[slotDef.id];
  if (isChoice(favorite)) return { choice: favorite, source: "favorite" };
  return {
    source: "suggested",
    choice: {
      catalogId: "",
      familyKey: "",
      familyName: slotDef.suggested.name,
      name: slotDef.suggested.name,
      brand: slotDef.suggested.brand,
      sizeLabel: slotDef.suggested.sizeLabel || "",
      updatedAt: 0,
    },
  };
}

function namesOf(product) {
  return [product?.name, product?.familyName, product?.catalogName].map(norm).filter(Boolean);
}

export function findChoice(choice, products) {
  if (!isChoice(choice)) return null;
  const rows = products || [];
  const id = clean(choice.catalogId, 80);
  if (id) return rows.find((product) => product?.id === id) || null;
  const family = clean(choice.familyKey, 120);
  const size = norm(choice.sizeLabel);
  if (family) {
    const familyHits = rows.filter((product) => product?.familyKey === family);
    if (size) return familyHits.find((product) => norm(product.variantLabel || product.sizeLabel || product.label) === size) || null;
    if (familyHits[0]) return familyHits[0];
  }
  const name = norm(choice.name);
  const brand = norm(choice.brand);
  if (!name) return null;
  return rows.find((product) => namesOf(product).includes(name) && (!brand || norm(product.brand) === brand)) || null;
}

const STOP = new Set(["the", "and", "with", "for", "pack", "oz", "fl", "ct", "classic", "size", "original", "style", "pk"]);

function meaningful(text) {
  return norm(text)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP.has(token) && !/^\d+$/.test(token));
}

/** Closest remaining family when a favorite is gone. Unrelated items stay unmatched. */
export function closestProduct(slotDef, wanted, products) {
  const want = new Set([
    ...meaningful(slotDef?.search),
    ...meaningful(slotDef?.label),
    ...meaningful(wanted?.name),
    ...meaningful(wanted?.familyName),
    ...meaningful(wanted?.brand),
  ]);
  const brand = norm(wanted?.brand);
  let best = null;
  let bestScore = 0;
  for (const product of products || []) {
    if (!product?.id) continue;
    if (wanted?.catalogId && product.id === wanted.catalogId) continue;
    const tokens = new Set([
      ...meaningful(product.name),
      ...meaningful(product.familyName),
      ...meaningful(product.catalogName),
      ...meaningful(product.brand),
    ]);
    let score = 0;
    for (const token of want) if (tokens.has(token)) score += 2;
    if (brand && norm(product.brand) === brand) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }
  return bestScore >= 2 ? best : null;
}

export function choiceLabel(choice) {
  const name = clean(choice?.familyName || choice?.name, 120) || "that item";
  const size = clean(choice?.sizeLabel, 80);
  return size && !name.toLowerCase().includes(size.toLowerCase()) ? `${name}, ${size}` : name;
}

/**
 * Favorite beats suggested. A per-list override beats the favorite.
 * A missing favorite falls back to the closest family and records a swap.
 * @param {{ slot: { id: string, serves: number, label: string, search: string, suggested: { name: string, brand: string, sizeLabel?: string } }, people: number, favorite?: SlotChoice | null, override?: SlotChoice | ClearedChoice | null, products?: Array<Record<string, unknown>>, quantity?: number }} input
 */
export function resolveSlot(input) {
  const slotDef = input.slot;
  const quantity =
    input.quantity == null ? scaleQuantity(slotDef.serves, input.people) : clampInt(input.quantity, 1, 99, 1);
  const override = input.override && input.override.cleared === true ? null : input.override || null;
  const favorite = input.favorite || null;
  const chosen = override || favorite;
  const source = override ? "override" : favorite ? "favorite" : "suggested";
  const target = chosen || {
    catalogId: "",
    familyKey: "",
    familyName: slotDef.suggested.name,
    name: slotDef.suggested.name,
    brand: slotDef.suggested.brand,
    sizeLabel: slotDef.suggested.sizeLabel || "",
    updatedAt: 0,
  };
  const hit = findChoice(target, input.products || []);
  if (hit) return { quantity, product: hit, source, swapped: null, missing: false };
  const fallback = closestProduct(slotDef, target, input.products || []);
  if (!fallback) {
    return { quantity, product: null, source: "missing", swapped: null, missing: true, wanted: choiceLabel(target) };
  }
  return {
    quantity,
    product: fallback,
    source: "fallback",
    missing: false,
    swapped: { from: choiceLabel(target), to: clean(fallback.familyName || fallback.name, 120) },
  };
}

export function choiceFromProduct(product, at = Date.now()) {
  return sanitizeChoice({
    catalogId: product?.id,
    familyKey: product?.familyKey,
    familyName: product?.familyName || product?.name,
    name: product?.catalogName || product?.name,
    brand: product?.brand,
    sizeLabel: product?.variantLabel || product?.sizeLabel || product?.label,
    updatedAt: at,
  });
}

export function setFavorite(book, slotId, choice, at = Date.now()) {
  const next = migrateBook(book);
  const saved = sanitizeChoice({ ...choice, updatedAt: at });
  if (!saved || saved.cleared) return next;
  next.favorites[slotId] = saved;
  next.nudged = true;
  return next;
}

export function setOverride(book, listId, slotId, choice, at = Date.now()) {
  const next = migrateBook(book);
  const saved = sanitizeChoice({ ...choice, updatedAt: at });
  if (!saved || saved.cleared) return next;
  next.overrides[listId] = { ...(next.overrides[listId] || {}), [slotId]: saved };
  next.nudged = true;
  return next;
}

export function clearOverride(book, listId, slotId, at = Date.now()) {
  const next = migrateBook(book);
  const current = next.overrides[listId] || {};
  next.overrides[listId] = { ...current, [slotId]: { cleared: true, updatedAt: at } };
  return next;
}

/** Shared favorite, and this list stops using its own override. */
export function rememberEverywhere(book, listId, slotId, choice, at = Date.now()) {
  return clearOverride(setFavorite(book, slotId, choice, at), listId, slotId, at);
}

export function newListId(at = Date.now()) {
  return `ml-${at.toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 40);
}

export function newSlotId(at = Date.now()) {
  return `cs-${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 40);
}

function touchList(book, id, at, change) {
  const next = migrateBook(book);
  const index = next.lists.findIndex((list) => list.id === id);
  if (index < 0) return next;
  const current = next.lists[index];
  const updated = change(current);
  next.lists[index] = { ...updated, updatedAt: at };
  return next;
}

export function createList(book, name, at = Date.now()) {
  const next = migrateBook(book);
  if (next.lists.length >= LIST_MAX) return next;
  const order = next.lists.reduce((max, list) => Math.max(max, list.order || 0), 0) + 1;
  next.lists.push({ id: newListId(at), name: clean(name, 40) || "My list", updatedAt: at, order, slots: [] });
  return next;
}

export function duplicateThemed(book, sourceId, at = Date.now()) {
  const source = themedList(sourceId) || listModel(sourceId, book);
  if (!source) return migrateBook(book);
  const before = migrateBook(book).lists.length;
  const next = createList(book, `My ${source.title}`.slice(0, 40), at);
  if (next.lists.length === before) return next;
  const created = next.lists[next.lists.length - 1];
  created.slots = source.slots.map((slotDef) => ({ slotId: slotDef.id }));
  const prior = book?.overrides?.[sourceId];
  if (prior) {
    const copy = {};
    for (const [slotId, choice] of Object.entries(prior)) {
      const saved = sanitizeChoice(choice);
      if (saved) copy[slotId] = { ...saved, updatedAt: at };
    }
    next.overrides[created.id] = copy;
  }
  return next;
}

export function renameList(book, id, name, at = Date.now()) {
  return touchList(book, id, at, (list) => ({ ...list, name: clean(name, 40) || "My list" }));
}

export function deleteList(book, id, at = Date.now()) {
  const next = migrateBook(book);
  next.lists = next.lists.filter((list) => list.id !== id);
  next.removed = [...next.removed.filter((entry) => entry.id !== id), { id, writtenAt: at }].slice(-REMOVED_MAX);
  return next;
}

export function moveList(book, id, direction, at = Date.now()) {
  const next = migrateBook(book);
  const lists = [...next.lists].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const index = lists.findIndex((list) => list.id === id);
  const swap = index + (direction < 0 ? -1 : 1);
  if (index < 0 || swap < 0 || swap >= lists.length) return next;
  const order = lists.map((list, place) => ({ ...list, order: place + 1 }));
  const from = order[index];
  order[index] = order[swap];
  order[swap] = from;
  next.lists = order.map((list, place) => ({ ...list, order: place + 1, updatedAt: list.id === id ? at : list.updatedAt }));
  return next;
}

export function addListSlot(book, id, slotRow, at = Date.now()) {
  return touchList(book, id, at, (list) => {
    const row = sanitizeSlotRow(slotRow);
    if (!row || list.slots.some((entry) => entry.slotId === row.slotId) || list.slots.length >= SLOT_MAX) return list;
    return { ...list, slots: [...list.slots, row] };
  });
}

export function removeListSlot(book, id, slotId, at = Date.now()) {
  return touchList(book, id, at, (list) => ({ ...list, slots: list.slots.filter((entry) => entry.slotId !== slotId) }));
}

export function moveListSlot(book, id, slotId, direction, at = Date.now()) {
  return touchList(book, id, at, (list) => {
    const slots = [...list.slots];
    const index = slots.findIndex((entry) => entry.slotId === slotId);
    const swap = index + (direction < 0 ? -1 : 1);
    if (index < 0 || swap < 0 || swap >= slots.length) return list;
    const [row] = slots.splice(index, 1);
    slots.splice(swap, 0, row);
    return { ...list, slots };
  });
}

export function slotMatches(query) {
  const q = norm(query);
  const all = Object.values(SLOTS);
  if (!q) return all.slice(0, 8);
  return all.filter((slotDef) => norm(slotDef.label).includes(q) || norm(slotDef.search).includes(q)).slice(0, 8);
}

export function readSwaps(storage) {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(SWAP_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      const from = clean(value?.from, 160);
      const to = clean(value?.to, 160);
      if (!from || !to) continue;
      out[clean(key, 80)] = { from, to };
    }
    return out;
  } catch {
    return {};
  }
}

export function writeSwaps(storage, swaps) {
  if (!storage) return;
  storage.setItem(SWAP_KEY, JSON.stringify(swaps || {}));
}

/** Plan line for a favorite that had to be replaced. Store swaps are left alone. */
export function annotateFavoriteSwap(item, swaps) {
  if (!item || item.matchKind === "swap" || item.matchKind === "substitute") return item;
  const name = norm(item.name);
  if (!name) return item;
  for (const swap of Object.values(swaps || {})) {
    const to = norm(swap.to);
    if (!to || name.length < 4 || to.length < 4) continue;
    if (name === to || name.includes(to) || to.includes(name)) {
      return { ...item, matchKind: "swap", substitutedFor: swap.from };
    }
  }
  return item;
}

export function picksForShelf(list, book) {
  const model = listModel(list?.id || list, book);
  if (!model) return [];
  const picks = [];
  for (const slotDef of model.slots) {
    const { choice } = activeChoice(book, model.id, slotDef);
    picks.push({ name: choice.name || slotDef.suggested.name, brand: choice.brand || "" });
    if (slotDef.search) picks.push({ name: slotDef.search, brand: "" });
  }
  return picks;
}
