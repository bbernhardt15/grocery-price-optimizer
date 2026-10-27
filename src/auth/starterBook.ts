/**
 * Favorites and My lists saved on the account's list document.
 * Absent on a write means "leave the stored book alone."
 * A present book merges by updatedAt, same idea as saved list items.
 * Version 1 is the first shape. A missing version is read as 1.
 * Prices and store names are not part of a choice.
 */

const LIST_MAX = 24;
const SLOT_MAX = 16;
const REMOVED_MAX = 24;
const BOOK_VERSION = 1;

export type SlotChoice = {
  catalogId: string;
  familyKey: string;
  familyName: string;
  name: string;
  brand: string;
  sizeLabel: string;
  updatedAt: number;
};

export type ClearedChoice = { cleared: true; updatedAt: number };

export type MyListSlot = {
  slotId: string;
  label?: string;
  search?: string;
  serves?: number;
  suggestedName?: string;
  suggestedBrand?: string;
  suggestedSize?: string;
};

export type MyList = {
  id: string;
  name: string;
  updatedAt: number;
  order: number;
  slots: MyListSlot[];
};

export type StarterBook = {
  version: number;
  favorites: Record<string, SlotChoice>;
  overrides: Record<string, Record<string, SlotChoice | ClearedChoice>>;
  lists: MyList[];
  removed: { id: string; writtenAt: number }[];
  nudged: boolean;
};

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

export function emptyStarterBook(): StarterBook {
  return { version: BOOK_VERSION, favorites: {}, overrides: {}, lists: [], removed: [], nudged: false };
}

function choiceOf(value: unknown): SlotChoice | ClearedChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.cleared === true) return { cleared: true, updatedAt: clampInt(row.updatedAt, 0, 9e15, 0) };
  const name = clean(row.name || row.familyName, 120);
  const familyName = clean(row.familyName || row.name, 120);
  if (!name && !familyName) return null;
  const rawId = clean(row.catalogId, 80);
  const rawKey = clean(row.familyKey, 120);
  const catalogId = /^[A-Za-z0-9:_-]{1,80}$/.test(rawId) ? rawId : "";
  const familyKey = /^[A-Za-z0-9:_ |-]{1,120}$/.test(rawKey) ? rawKey : "";
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

function slotRow(value: unknown): MyListSlot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const slotId = clean(row.slotId || row.id, 40).toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(slotId)) return null;
  const label = clean(row.label, 40);
  if (!label) return { slotId };
  return {
    slotId,
    label,
    search: clean(row.search, 60) || label,
    serves: clampInt(row.serves, 1, 24, 4),
    suggestedName: clean(row.suggestedName, 120) || label,
    suggestedBrand: clean(row.suggestedBrand, 80),
    suggestedSize: clean(row.suggestedSize, 80),
  };
}

function listOf(value: unknown): MyList | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = clean(row.id, 40).toLowerCase();
  if (!/^[a-z0-9-]{8,40}$/.test(id)) return null;
  const slots: MyListSlot[] = [];
  const seen = new Set<string>();
  if (Array.isArray(row.slots)) {
    for (const entry of row.slots) {
      const slot = slotRow(entry);
      if (!slot || seen.has(slot.slotId)) continue;
      seen.add(slot.slotId);
      slots.push(slot);
      if (slots.length >= SLOT_MAX) break;
    }
  }
  return {
    id,
    name: clean(row.name, 40) || "My list",
    updatedAt: clampInt(row.updatedAt, 0, 9e15, 0),
    order: clampInt(row.order, 0, 9999, 0),
    slots,
  };
}

function choiceMap(value: unknown): Record<string, SlotChoice | ClearedChoice> {
  const out: Record<string, SlotChoice | ClearedChoice> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
    const id = clean(key, 40).toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(id)) continue;
    const choice = choiceOf(entry);
    if (choice) out[id] = choice;
  }
  return out;
}

export function parseStarterBook(value: unknown): StarterBook | { error: string } | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return { error: "starterBook must be an object." };
  let encoded = "";
  try {
    encoded = JSON.stringify(value);
  } catch {
    return { error: "starterBook must be an object." };
  }
  if (encoded.length > 100_000) return { error: "starterBook is too large." };
  const row = value as Record<string, unknown>;
  const lists: MyList[] = [];
  const seen = new Set<string>();
  if (Array.isArray(row.lists)) {
    for (const entry of row.lists) {
      const list = listOf(entry);
      if (!list || seen.has(list.id)) continue;
      seen.add(list.id);
      lists.push(list);
      if (lists.length >= LIST_MAX) break;
    }
  }
  const removed: { id: string; writtenAt: number }[] = [];
  if (Array.isArray(row.removed)) {
    for (const entry of row.removed) {
      if (!entry || typeof entry !== "object") continue;
      const removedRow = entry as Record<string, unknown>;
      const id = clean(removedRow.id, 40).toLowerCase();
      if (!/^[a-z0-9-]{8,40}$/.test(id)) continue;
      removed.push({ id, writtenAt: clampInt(removedRow.writtenAt, 0, 9e15, 0) });
      if (removed.length >= REMOVED_MAX) break;
    }
  }
  const overrides: StarterBook["overrides"] = {};
  if (row.overrides && typeof row.overrides === "object" && !Array.isArray(row.overrides)) {
    for (const [key, entry] of Object.entries(row.overrides as Record<string, unknown>).slice(0, LIST_MAX)) {
      const id = clean(key, 40).toLowerCase();
      if (!/^[a-z0-9-]{2,40}$/.test(id)) continue;
      const slots = choiceMap(entry);
      if (Object.keys(slots).length) overrides[id] = slots;
    }
  }
  const favorites: StarterBook["favorites"] = {};
  for (const [key, choice] of Object.entries(choiceMap(row.favorites))) {
    if ("cleared" in choice) continue;
    favorites[key] = choice;
  }
  return {
    version: clampInt(row.version, 1, BOOK_VERSION, 1),
    favorites,
    overrides,
    lists,
    removed,
    nudged: row.nudged === true,
  };
}

function newer<T extends { updatedAt: number }>(left: T | undefined, right: T | undefined): T | undefined {
  if (!left) return right;
  if (!right) return left;
  return right.updatedAt >= left.updatedAt ? right : left;
}

/** Later favorite, override, or list wins. A newer delete stays deleted. */
function asBook(value: unknown): StarterBook {
  const parsed = parseStarterBook(value);
  if (!parsed || "error" in parsed) return emptyStarterBook();
  return parsed;
}

export function mergeStarterBooks(base: unknown, incoming: unknown): StarterBook {
  const left = asBook(base);
  const right = asBook(incoming);
  const favorites = { ...left.favorites };
  for (const [key, choice] of Object.entries(right.favorites)) {
    const winner = newer(favorites[key], choice);
    if (winner && !("cleared" in winner)) favorites[key] = winner;
  }
  const overrides: StarterBook["overrides"] = { ...left.overrides };
  for (const [listId, slots] of Object.entries(right.overrides)) {
    const merged = { ...(overrides[listId] || {}) };
    for (const [slotId, choice] of Object.entries(slots)) {
      const winner = newer(merged[slotId], choice);
      if (winner) merged[slotId] = winner;
    }
    overrides[listId] = merged;
  }
  const tombstones = new Map<string, number>();
  for (const entry of [...left.removed, ...right.removed]) {
    const prior = tombstones.get(entry.id) || 0;
    if (entry.writtenAt >= prior) tombstones.set(entry.id, entry.writtenAt);
  }
  const byId = new Map<string, MyList>();
  for (const list of [...left.lists, ...right.lists]) {
    const winner = newer(byId.get(list.id), list);
    if (winner) byId.set(list.id, winner);
  }
  const lists: MyList[] = [];
  for (const list of byId.values()) {
    const killed = tombstones.get(list.id);
    if (killed != null && killed >= list.updatedAt) continue;
    lists.push(list);
  }
  lists.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const live = new Map(lists.map((list) => [list.id, list.updatedAt]));
  const removed: StarterBook["removed"] = [];
  for (const [id, writtenAt] of tombstones) {
    const updated = live.get(id);
    if (updated != null && updated > writtenAt) continue;
    removed.push({ id, writtenAt });
  }
  return {
    version: BOOK_VERSION,
    favorites,
    overrides,
    lists: lists.slice(0, LIST_MAX),
    removed: removed.slice(-REMOVED_MAX),
    nudged: left.nudged || right.nudged,
  };
}
