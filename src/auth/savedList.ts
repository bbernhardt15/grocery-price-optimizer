import { SavedList, type RemovedItem, type SavedListItem } from "./models";

export type { RemovedItem, SavedListItem };

const MAX_ITEMS = 100;
const MAX_NAME = 120;

export type SavedListWrite = {
  listId: string;
  listName: string;
  zip: string;
  alertsEnabled: boolean;
  items: SavedListItem[];
  removed: RemovedItem[];
  baseRevision: number | null;
};

export type PublicSavedList = {
  listId: string;
  listName: string;
  zip: string;
  alertsEnabled: boolean;
  items: SavedListItem[];
  revision: number;
  updatedAt: string | null;
};

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function itemIdOf(row: { id?: string; itemId?: string }): string {
  return row.itemId || row.id || "";
}

export function parseSavedItem(value: unknown): SavedListItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = cleanText(row.id || row.itemId, 400);
  const name = cleanText(row.name, MAX_NAME);
  if (!id || !name) return null;
  const quantity = typeof row.quantity === "number" && Number.isFinite(row.quantity) ? Math.min(99, Math.max(1, Math.floor(row.quantity))) : 1;
  const watch = row.watch === "on" || row.watch === "off" ? row.watch : "inherit";
  const writtenAt = typeof row.writtenAt === "number" && Number.isFinite(row.writtenAt) ? row.writtenAt : 0;
  const baseline = typeof row.baselinePrice === "number" && row.baselinePrice > 0 ? row.baselinePrice : undefined;
  const target = typeof row.targetPrice === "number" && row.targetPrice > 0 ? row.targetPrice : undefined;
  const item: SavedListItem = {
    id,
    name,
    brand: cleanText(row.brand, 80),
    sizeLabel: cleanText(row.sizeLabel, 80),
    quantity,
    checked: row.checked === true,
    writtenAt,
    baselineStore: cleanText(row.baselineStore, 80),
    watch,
  };
  const itemId = cleanText(row.itemId, 400);
  if (itemId) item.itemId = itemId;
  const addedBy = cleanText(row.addedBy, 40);
  const checkedBy = cleanText(row.checkedBy, 40);
  if (addedBy) item.addedBy = addedBy;
  if (checkedBy) item.checkedBy = checkedBy;
  if (baseline != null) item.baselinePrice = baseline;
  if (target != null) item.targetPrice = target;
  return item;
}

export function parseSavedListWrite(body: unknown): SavedListWrite | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Send the saved list as a JSON object." };
  }
  const row = body as Record<string, unknown>;
  const listId = cleanText(row.listId, 80);
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(listId)) {
    return { error: "listId must be 8–80 letters, numbers, dashes, or underscores." };
  }
  if (!Array.isArray(row.items) || row.items.length > MAX_ITEMS) {
    return { error: "items must be a list of at most 100 products." };
  }
  const items: SavedListItem[] = [];
  for (const entry of row.items) {
    const item = parseSavedItem(entry);
    if (!item) return { error: "Each item needs an id and a name." };
    items.push(item);
  }
  const removed: RemovedItem[] = [];
  if (row.removed != null) {
    if (!Array.isArray(row.removed) || row.removed.length > MAX_ITEMS) {
      return { error: "removed must be a list of ids." };
    }
    for (const entry of row.removed) {
      if (!entry || typeof entry !== "object") return { error: "removed must be a list of ids." };
      const removedRow = entry as Record<string, unknown>;
      const id = cleanText(removedRow.id, 400);
      const writtenAt = typeof removedRow.writtenAt === "number" ? removedRow.writtenAt : 0;
      if (!id) return { error: "removed must be a list of ids." };
      removed.push({ id, writtenAt });
    }
  }
  const baseRevision =
    row.baseRevision == null ? null : typeof row.baseRevision === "number" && Number.isInteger(row.baseRevision) ? row.baseRevision : NaN;
  if (typeof baseRevision === "number" && Number.isNaN(baseRevision)) {
    return { error: "baseRevision must be the revision you last saved." };
  }
  const zip = cleanText(row.zip, 10);
  return {
    listId,
    listName: cleanText(row.listName, 80) || "My list",
    zip: /^\d{5}/.test(zip) ? zip.slice(0, 5) : "",
    alertsEnabled: row.alertsEnabled === true,
    items,
    removed,
    baseRevision,
  };
}

/**
 * Matching revision: the caller's list replaces the saved one.
 * An older revision keeps both sides. The later write of an item wins.
 * A removal wins when its time is at least the item's write time.
 */
export function mergeSavedItems(
  base: readonly SavedListItem[],
  incoming: readonly SavedListItem[],
  removed: readonly RemovedItem[],
  replace: boolean
): SavedListItem[] {
  const map = new Map<string, SavedListItem>();
  if (!replace) {
    for (const item of base) map.set(itemIdOf(item), item);
  }
  for (const item of incoming) {
    const key = itemIdOf(item);
    const existing = map.get(key);
    if (!existing || item.writtenAt >= existing.writtenAt) map.set(key, item);
  }
  for (const entry of removed) {
    const key = entry.id;
    const existing = map.get(key);
    if (!existing || entry.writtenAt >= existing.writtenAt) map.delete(key);
  }
  return [...map.values()].slice(0, MAX_ITEMS);
}

export function toPublicSavedList(doc: {
  listId: string;
  listName?: string;
  zip?: string;
  alertsEnabled?: boolean;
  items?: SavedListItem[];
  revision: number;
  updatedAt?: Date;
}): PublicSavedList {
  return {
    listId: doc.listId,
    listName: doc.listName || "My list",
    zip: doc.zip || "",
    alertsEnabled: doc.alertsEnabled === true,
    items: Array.isArray(doc.items) ? doc.items : [],
    revision: doc.revision,
    updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
  };
}

export async function readSavedList(accountId: string): Promise<PublicSavedList | null> {
  const doc = await SavedList.findOne({ accountId }).lean();
  if (!doc) return null;
  return toPublicSavedList(doc as unknown as Parameters<typeof toPublicSavedList>[0]);
}

export async function writeSavedList(accountId: string, write: SavedListWrite): Promise<PublicSavedList> {
  const existing = await SavedList.findOne({ accountId }).lean();
  if (!existing) {
    const items = mergeSavedItems([], write.items, write.removed, true);
    const created = await SavedList.create({
      accountId,
      listId: write.listId,
      listName: write.listName,
      zip: write.zip,
      alertsEnabled: write.alertsEnabled,
      items,
      removed: write.removed.slice(-MAX_ITEMS),
      revision: 1,
    });
    return toPublicSavedList(created.toObject() as unknown as Parameters<typeof toPublicSavedList>[0]);
  }
  const current = existing as unknown as {
    items?: SavedListItem[];
    revision: number;
    removed?: RemovedItem[];
  };
  const replace = write.baseRevision != null && write.baseRevision === current.revision;
  const priorRemoved = replace ? [] : current.removed ?? [];
  const items = mergeSavedItems(current.items ?? [], write.items, [...priorRemoved, ...write.removed], replace);
  const saved = await SavedList.findOneAndUpdate(
    { accountId },
    {
      $set: {
        listId: (existing as { listId?: string }).listId || write.listId,
        listName: write.listName,
        zip: write.zip,
        alertsEnabled: write.alertsEnabled,
        items,
        removed: [...priorRemoved, ...write.removed].slice(-MAX_ITEMS),
        revision: current.revision + 1,
      },
    },
    { new: true }
  ).lean();
  return toPublicSavedList(saved as unknown as Parameters<typeof toPublicSavedList>[0]);
}
