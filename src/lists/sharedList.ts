import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Live rows on one shared list. Tombstones are extra and are not shown. */
export const MAX_LIST_ITEMS = 100;
export const MAX_TOMBSTONES = 100;
export const MAX_ITEM_NAME = 120;
export const MAX_DISPLAY_NAME = 40;
export const MAX_BRAND = 80;
export const MAX_SIZE_LABEL = 80;
export const MAX_TITLE = 80;
export const MAX_QUANTITY = 99;
/** Catalog ids look like `local:store:brand:name:size` with each part capped at 80. */
export const MAX_ITEM_ID = 400;
/** Reject client clocks that are more than two minutes ahead of the server. */
export const WRITE_SKEW_MS = 2 * 60 * 1000;
/** 32 random bytes, base64url, is 43 characters. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

const ITEM_ID_PATTERN = new RegExp(`^[A-Za-z0-9:._-]{1,${MAX_ITEM_ID}}$`);

export type ListMode = "edit" | "view";
export type ListRole = "owner" | "guest";

export type SharedItem = {
  itemId: string;
  catalogId?: string;
  name: string;
  brand?: string;
  sizeLabel?: string;
  quantity: number;
  checked: boolean;
  addedBy?: string;
  checkedBy?: string;
  writtenAt: number;
  updatedAt: string;
  deleted: boolean;
};

export type ItemWrite = {
  itemId: string;
  catalogId?: string;
  name: string;
  brand?: string;
  sizeLabel?: string;
  quantity: number;
  checked: boolean;
  writtenAt: number;
  deleted: boolean;
};

export type PublicItem = {
  itemId: string;
  catalogId?: string;
  name?: string;
  brand?: string;
  sizeLabel?: string;
  quantity?: number;
  checked?: boolean;
  addedBy?: string;
  checkedBy?: string;
  writtenAt: number;
  updatedAt: string;
  deleted: boolean;
};

export type PublicList = {
  shareToken: string;
  title: string;
  mode: ListMode;
  role: ListRole;
  canEdit: boolean;
  revoked: boolean;
  seq: number;
  updatedAt: string;
  changed: true;
  items: PublicItem[];
};

export type PollBody =
  | PublicList
  | {
      changed: false;
      shareToken: string;
      title: string;
      mode: ListMode;
      role: ListRole;
      canEdit: boolean;
      revoked: boolean;
      seq: number;
      updatedAt: string;
    };

export function newSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isShareToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** Compare a presented secret to a stored hash without leaking the raw secret. */
export function secretMatches(token: string, expectedHash: string): boolean {
  if (!isShareToken(token) || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    return false;
  }
  const actual = Buffer.from(hashSecret(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return timingSafeEqual(actual, expected);
}

export function cleanDisplayName(value: unknown): string | undefined {
  return cleanText(value, MAX_DISPLAY_NAME);
}

export function cleanTitle(value: unknown): string {
  return cleanText(value, MAX_TITLE) ?? "Shopping list";
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function clampWrittenAt(value: unknown, serverNow: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return serverNow;
  }
  const max = serverNow + WRITE_SKEW_MS;
  const min = serverNow - 366 * 24 * 60 * 60 * 1000;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function parseItemWrite(input: unknown, serverNow: number): ItemWrite | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Each item must be an object." };
  }
  const record = input as Record<string, unknown>;
  const itemId = typeof record.itemId === "string" ? record.itemId.trim() : "";
  if (!ITEM_ID_PATTERN.test(itemId)) {
    return { error: "Each item needs an id made of letters, numbers, and simple punctuation." };
  }
  const catalogRaw = typeof record.catalogId === "string" ? record.catalogId.trim() : "";
  if (catalogRaw && !ITEM_ID_PATTERN.test(catalogRaw)) {
    return { error: "A catalog id has characters this list cannot store." };
  }
  const deleted = record.deleted === true;
  const name = cleanText(record.name, MAX_ITEM_NAME);
  if (!deleted && !name) {
    return { error: "Each item needs a name." };
  }
  const quantity = normalizeQuantity(record.quantity, deleted);
  if (quantity === null) {
    return { error: `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.` };
  }
  return {
    itemId,
    catalogId: catalogRaw || undefined,
    name: name ?? "Item",
    brand: cleanText(record.brand, MAX_BRAND),
    sizeLabel: cleanText(record.sizeLabel, MAX_SIZE_LABEL),
    quantity,
    checked: record.checked === true,
    writtenAt: clampWrittenAt(record.writtenAt, serverNow),
    deleted,
  };
}

function normalizeQuantity(value: unknown, deleted: boolean): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return deleted ? 1 : null;
  }
  const quantity = Math.trunc(parsed);
  if (deleted) {
    return Math.min(MAX_QUANTITY, Math.max(1, quantity || 1));
  }
  if (quantity < 1 || quantity > MAX_QUANTITY) {
    return null;
  }
  return quantity;
}

export function parseItemWrites(
  items: unknown,
  serverNow: number
): { writes: ItemWrite[] } | { error: string } {
  if (items === undefined) {
    return { writes: [] };
  }
  if (!Array.isArray(items)) {
    return { error: "Items must be a list." };
  }
  if (items.length > MAX_LIST_ITEMS) {
    return { error: `A shared list can hold up to ${MAX_LIST_ITEMS} items.` };
  }
  const writes: ItemWrite[] = [];
  for (const item of items) {
    const parsed = parseItemWrite(item, serverNow);
    if ("error" in parsed) {
      return parsed;
    }
    writes.push(parsed);
  }
  return { writes };
}

export type ApplyResult = { ok: true; items: SharedItem[]; changed: boolean } | { ok: false; error: string };

/**
 * Last-write-wins per item. A later `writtenAt` replaces that item only.
 * The same timestamp keeps the stored item. A newer delete leaves a tombstone
 * so an older add cannot bring the row back.
 */
export function applyItemWrites(
  existing: readonly SharedItem[],
  writes: readonly ItemWrite[],
  displayName: string | undefined,
  serverNow: number
): ApplyResult {
  if (writes.length === 0) {
    return { ok: false, error: "Send at least one item change." };
  }
  if (writes.length > MAX_LIST_ITEMS) {
    return { ok: false, error: `A shared list can hold up to ${MAX_LIST_ITEMS} items.` };
  }

  const items = new Map<string, SharedItem>();
  for (const item of existing) {
    items.set(item.itemId, { ...item });
  }

  let changed = false;
  const updatedAt = new Date(serverNow).toISOString();
  for (const write of writes) {
    const stored = items.get(write.itemId);
    if (stored && write.writtenAt <= stored.writtenAt) {
      continue;
    }
    changed = true;
    if (write.deleted) {
      items.set(write.itemId, {
        itemId: write.itemId,
        catalogId: stored?.catalogId ?? write.catalogId,
        name: stored?.name || write.name,
        brand: stored?.brand,
        sizeLabel: stored?.sizeLabel,
        quantity: stored?.quantity || write.quantity,
        checked: stored?.checked ?? false,
        addedBy: stored?.addedBy,
        checkedBy: stored?.checkedBy,
        writtenAt: write.writtenAt,
        updatedAt,
        deleted: true,
      });
      continue;
    }

    const wasLive = Boolean(stored && !stored.deleted);
    const checkedChanged = !wasLive || stored?.checked !== write.checked;
    let checkedBy = wasLive ? stored?.checkedBy : undefined;
    if (checkedChanged) {
      checkedBy = write.checked ? displayName : undefined;
    }
    items.set(write.itemId, {
      itemId: write.itemId,
      catalogId: write.catalogId ?? stored?.catalogId,
      name: write.name,
      brand: write.brand,
      sizeLabel: write.sizeLabel,
      quantity: write.quantity,
      checked: write.checked,
      addedBy: wasLive ? stored?.addedBy : displayName,
      checkedBy,
      writtenAt: write.writtenAt,
      updatedAt,
      deleted: false,
    });
  }

  const live = [...items.values()].filter((item) => !item.deleted);
  if (live.length > MAX_LIST_ITEMS) {
    return { ok: false, error: `A shared list can hold up to ${MAX_LIST_ITEMS} items.` };
  }
  const tombstones = [...items.values()]
    .filter((item) => item.deleted)
    .sort((a, b) => b.writtenAt - a.writtenAt)
    .slice(0, MAX_TOMBSTONES);
  return { ok: true, items: [...live, ...tombstones], changed };
}

export function storedItems(value: unknown): SharedItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: SharedItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const itemId = typeof record.itemId === "string" ? record.itemId : "";
    if (!ITEM_ID_PATTERN.test(itemId)) {
      continue;
    }
    const updatedAt =
      record.updatedAt instanceof Date
        ? record.updatedAt.toISOString()
        : typeof record.updatedAt === "string"
          ? record.updatedAt
          : new Date(0).toISOString();
    items.push({
      itemId,
      catalogId: typeof record.catalogId === "string" ? record.catalogId : undefined,
      name: typeof record.name === "string" && record.name.trim() ? record.name : "Item",
      brand: typeof record.brand === "string" ? record.brand : undefined,
      sizeLabel: typeof record.sizeLabel === "string" ? record.sizeLabel : undefined,
      quantity: typeof record.quantity === "number" ? record.quantity : 1,
      checked: record.checked === true,
      addedBy: typeof record.addedBy === "string" ? record.addedBy : undefined,
      checkedBy: typeof record.checkedBy === "string" ? record.checkedBy : undefined,
      writtenAt: typeof record.writtenAt === "number" ? record.writtenAt : 0,
      updatedAt,
      deleted: record.deleted === true,
    });
  }
  return items;
}

export function toPublicList(input: {
  shareToken: string;
  title: string;
  mode: ListMode;
  role: ListRole;
  seq: number;
  updatedAt: Date | string;
  revoked?: boolean;
  items: readonly SharedItem[];
}): PublicList {
  const revoked = Boolean(input.revoked);
  const canEdit = input.role === "owner" || (input.mode === "edit" && !revoked);
  return {
    shareToken: input.shareToken,
    title: input.title,
    mode: input.mode,
    role: input.role,
    canEdit,
    revoked,
    seq: input.seq,
    updatedAt: input.updatedAt instanceof Date ? input.updatedAt.toISOString() : input.updatedAt,
    changed: true,
    items: input.items.map((item) => {
      if (item.deleted) {
        return {
          itemId: item.itemId,
          writtenAt: item.writtenAt,
          updatedAt: item.updatedAt,
          deleted: true,
        };
      }
      return {
        itemId: item.itemId,
        catalogId: item.catalogId,
        name: item.name,
        brand: item.brand,
        sizeLabel: item.sizeLabel,
        quantity: item.quantity,
        checked: item.checked,
        addedBy: item.addedBy,
        checkedBy: item.checkedBy,
        writtenAt: item.writtenAt,
        updatedAt: item.updatedAt,
        deleted: false,
      };
    }),
  };
}

export function pollBody(list: PublicList, since: number | undefined): PollBody {
  if (since !== undefined && since >= list.seq) {
    return {
      changed: false,
      shareToken: list.shareToken,
      title: list.title,
      mode: list.mode,
      role: list.role,
      canEdit: list.canEdit,
      revoked: list.revoked,
      seq: list.seq,
      updatedAt: list.updatedAt,
    };
  }
  return list;
}

export type RateLimiter = {
  allow(key: string, limit: number): boolean;
  reset(): void;
};

export function createRateLimiter(options: { windowMs: number; now?: () => number }): RateLimiter {
  const buckets = new Map<string, number[]>();
  const now = options.now ?? (() => Date.now());
  return {
    allow(key: string, limit: number): boolean {
      const time = now();
      const recent = (buckets.get(key) ?? []).filter((stamp) => time - stamp < options.windowMs);
      if (recent.length >= limit) {
        buckets.set(key, recent);
        return false;
      }
      recent.push(time);
      buckets.set(key, recent);
      return true;
    },
    reset(): void {
      buckets.clear();
    },
  };
}
