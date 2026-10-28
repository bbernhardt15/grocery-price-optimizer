/**
 * Walmart refresh batching.
 *
 * Affiliate Product Lookup is `GET /items` on the affiliate host.
 * `ids` is a comma-separated item-id list. `upc` is a comma-separated UPC list.
 * Both lists are documented at 20, the same cap as OPD price-availability
 * `offerIds`. This process does not call OPD. One HTTP request is one ingest
 * call, however many ids it carries.
 */

import { walmartUpcForLookup } from "../catalog/normalize";

/** Affiliate `ids` / `upc` list length, and the OPD offerIds cap. */
export const WALMART_LOOKUP_IDS_MAX = 20;

/** After this many confirmed misses the offer leaves the refresh queue. */
export const REFRESH_MAX_MISSES = 3;

export type RefreshLookupKey = {
  offerId: string;
  /** 12-digit UPC-A when we have one. Empty when the master only has an item id. */
  code: string;
  itemId?: string;
};

export type WalmartRefreshPlan = {
  mode: "ids" | "upc";
  /** Distinct values for this one HTTP call, in pick order. */
  values: string[];
  offerIds: string[];
};

export type WalmartRefreshItem = {
  itemId?: string | number;
  upc?: string;
  name?: string;
  salePrice?: number | null;
  msrp?: number | null;
  stock?: string;
};

export type ClassifiedRefresh = {
  priced: string[];
  unavailable: string[];
  missing: string[];
};

/** Numeric Walmart item id safe to put on `ids`. */
export function walmartItemIdForLookup(id: string | undefined | null): string | null {
  const trimmed = id?.trim() ?? "";
  if (!/^\d{3,14}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * One Affiliate call. Item ids win when the first eligible offer has one,
 * because a multi-UPC `upc` list has returned HTTP 400 and pinned the crawl
 * to a single id. Offers that do not fit this call stay in the queue.
 */
export function planWalmartRefreshBatch(picks: RefreshLookupKey[], maxIds: number): WalmartRefreshPlan | null {
  const cap = Math.max(1, Math.min(WALMART_LOOKUP_IDS_MAX, Math.floor(maxIds) || 1));
  const first = picks.find((pick) => walmartItemIdForLookup(pick.itemId) || /^\d{12,14}$/.test(pick.code));
  if (!first) {
    return null;
  }
  const mode = walmartItemIdForLookup(first.itemId) ? "ids" : "upc";
  const values: string[] = [];
  const offerIds: string[] = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    const value = mode === "ids" ? walmartItemIdForLookup(pick.itemId) : /^\d{12,14}$/.test(pick.code) ? pick.code : null;
    if (!value) {
      continue;
    }
    if (!seen.has(value)) {
      if (values.length >= cap) {
        break;
      }
      seen.add(value);
      values.push(value);
    }
    if (seen.has(value)) {
      offerIds.push(pick.offerId);
    }
  }
  if (values.length === 0) {
    return null;
  }
  return { mode, values, offerIds };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Items array from an Affiliate `/items` payload. */
export function walmartItemsFromPayload(payload: unknown): WalmartRefreshItem[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(asRecord(payload)?.items)
      ? (asRecord(payload)?.items as unknown[])
      : [];
  const items: WalmartRefreshItem[] = [];
  for (const entry of list) {
    const row = asRecord(entry);
    if (!row) {
      continue;
    }
    const upc = typeof row.upc === "string" ? row.upc : typeof row.upc === "number" ? String(Math.trunc(row.upc)) : undefined;
    items.push({
      itemId: typeof row.itemId === "string" || typeof row.itemId === "number" ? row.itemId : undefined,
      ...(upc ? { upc } : {}),
      ...(typeof row.name === "string" ? { name: row.name } : {}),
      salePrice: numberOrNull(row.salePrice),
      msrp: numberOrNull(row.msrp),
      ...(typeof row.stock === "string" ? { stock: row.stock } : {}),
    });
  }
  return items;
}

function sameUpc(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  const a = walmartUpcForLookup(left);
  const b = walmartUpcForLookup(right);
  return Boolean(a && b && a === b);
}

function itemMatches(item: WalmartRefreshItem, pick: RefreshLookupKey): boolean {
  const itemId = item.itemId != null ? String(item.itemId).trim() : "";
  if (pick.itemId && itemId && itemId === pick.itemId) {
    return true;
  }
  return sameUpc(pick.code, item.upc ?? "");
}

function usablePrice(item: WalmartRefreshItem): boolean {
  const price =
    typeof item.salePrice === "number" && item.salePrice >= 0
      ? item.salePrice
      : typeof item.msrp === "number" && item.msrp >= 0
        ? item.msrp
        : null;
  return price !== null && Boolean(item.name?.trim());
}

/**
 * Split a successful response. Priced rows can be upserted. An item that came
 * back without a price is unavailable. An id that was asked for and omitted
 * is missing. Missing ids must be stamped so the next tick does not send them
 * again immediately.
 */
export function classifyWalmartRefresh(items: WalmartRefreshItem[], picks: RefreshLookupKey[]): ClassifiedRefresh {
  const priced: string[] = [];
  const unavailable: string[] = [];
  const missing: string[] = [];
  for (const pick of picks) {
    const hits = items.filter((item) => itemMatches(item, pick));
    if (hits.length === 0) {
      missing.push(pick.offerId);
      continue;
    }
    if (hits.some((item) => usablePrice(item))) {
      priced.push(pick.offerId);
    } else {
      unavailable.push(pick.offerId);
    }
  }
  return { priced, unavailable, missing };
}

/** Ledger cost of one batched refresh. The id count does not multiply the call. */
export function walmartRefreshCallCost(_idCount: number): number {
  return 1;
}

/** How many offers a daily call budget can touch when each call carries `idsPerCall` ids. */
export function walmartOffersPerBudget(calls: number, idsPerCall: number): number {
  const perCall = Math.max(1, Math.min(WALMART_LOOKUP_IDS_MAX, Math.floor(idsPerCall) || 1));
  return Math.max(0, Math.floor(calls)) * perCall;
}

/**
 * Next refresh batch size after one call.
 * A 400 shrinks the following call. A success doubles back toward the
 * configured cap. A single-id 400 stays at 1 only for that bad id; the caller
 * marks the id missing and the next success grows the batch again.
 * Undefined means "use the configured cap".
 */
export function nextRefreshBatchLimit(
  current: number | undefined,
  sent: number,
  configured: number,
  failed: boolean
): number | undefined {
  const cap = Math.max(1, Math.min(WALMART_LOOKUP_IDS_MAX, Math.floor(configured) || 1));
  const active = current && current > 0 ? Math.min(Math.floor(current), cap) : cap;
  const count = Math.max(1, Math.floor(sent) || 1);
  if (failed) {
    if (count <= 1) {
      return 1;
    }
    return Math.max(1, Math.floor(count / 2));
  }
  if (active >= cap) {
    return undefined;
  }
  const grown = Math.min(cap, Math.max(active, count) * 2);
  return grown >= cap ? undefined : grown;
}
