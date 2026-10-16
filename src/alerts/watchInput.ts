import { catalogProductKey } from "./compare";
import type { ItemWatchMode, PriceWatchItem } from "./models";

const DEVICE_ID = /^[A-Za-z0-9_-]{8,80}$/;
/** Local list ids are short. A shared-list token is 43–128 characters. */
const LIST_ID = /^[A-Za-z0-9_-]{8,128}$/;
const PRODUCT_ID = /^[A-Za-z0-9:._-]{1,200}$/;

export function parsePublicId(value: unknown): string | null {
  if (typeof value !== "string" || !DEVICE_ID.test(value)) {
    return null;
  }
  return value;
}

export function parseListId(value: unknown): string | null {
  if (typeof value !== "string" || !LIST_ID.test(value)) {
    return null;
  }
  return value;
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);
}

function parseZip(value: unknown): string | null {
  if (value == null || value === "") {
    return "";
  }
  if (typeof value !== "string") {
    return null;
  }
  const zip = value.trim();
  if (!zip) {
    return "";
  }
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) {
    return null;
  }
  return zip.slice(0, 5);
}

function parseMoney(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 100_000) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

export function parseWatchItems(value: unknown): PriceWatchItem[] | null {
  if (!Array.isArray(value) || value.length > 150) {
    return null;
  }
  const items: PriceWatchItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const row = raw as Record<string, unknown>;
    const productId = typeof row.productId === "string" ? row.productId.trim() : "";
    if (!PRODUCT_ID.test(productId)) {
      return null;
    }
    const productKey = catalogProductKey(productId);
    if (!productKey || seen.has(productKey)) {
      return null;
    }
    const name = clip(row.name, 160);
    if (!name) {
      return null;
    }
    const baselinePrice = parseMoney(row.baselinePrice);
    if (baselinePrice == null) {
      return null;
    }
    const watch: ItemWatchMode = row.watch === "on" || row.watch === "off" || row.watch === "inherit" ? row.watch : "inherit";
    let targetPrice: number | undefined;
    if (row.targetPrice != null && row.targetPrice !== "") {
      const parsed = parseMoney(row.targetPrice);
      if (parsed == null) {
        return null;
      }
      targetPrice = parsed;
    }
    seen.add(productKey);
    items.push({
      productId,
      productKey,
      name,
      brand: clip(row.brand, 80),
      watch,
      baselinePrice,
      baselineStore: clip(row.baselineStore, 80),
      ...(targetPrice != null ? { targetPrice } : {}),
    });
  }
  return items;
}

export type WatchBody = {
  deviceId: string;
  listId: string;
  listName: string;
  zip: string;
  enabled: boolean;
  items: PriceWatchItem[];
};

export function parseWatchBody(body: unknown): WatchBody | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const row = body as Record<string, unknown>;
  const deviceId = parsePublicId(row.deviceId);
  const listId = parseListId(row.listId);
  const zip = parseZip(row.zip);
  const items = parseWatchItems(row.items);
  if (!deviceId || !listId || zip == null || !items) {
    return null;
  }
  const listName = clip(row.listName, 80) || "My list";
  return {
    deviceId,
    listId,
    listName,
    zip,
    enabled: row.enabled === true,
    items,
  };
}

export function parsePushSubscription(body: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const row = body as Record<string, unknown>;
  const subscription = row.subscription;
  if (!subscription || typeof subscription !== "object") {
    return null;
  }
  const sub = subscription as Record<string, unknown>;
  if (typeof sub.endpoint !== "string" || sub.endpoint.length > 2000) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(sub.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") {
    return null;
  }
  const keys = sub.keys;
  if (!keys || typeof keys !== "object") {
    return null;
  }
  const keyRow = keys as Record<string, unknown>;
  const p256dh = typeof keyRow.p256dh === "string" ? keyRow.p256dh.trim() : "";
  const auth = typeof keyRow.auth === "string" ? keyRow.auth.trim() : "";
  if (!p256dh || !auth || p256dh.length > 200 || auth.length > 200) {
    return null;
  }
  return { endpoint: url.href, p256dh, auth };
}
