/**
 * The trip that was on screen when the shopper left for a store.
 * A new tab, or a tab iOS threw away, reads it once and lands on the
 * same step. A later read does not move the tab.
 */

import { readTripDb, writeTripDb } from "./tripSync.js";

export const HANDOFF_TRIP_KEY = "gg-handoff-trip";
export const HANDOFF_TRIP_MAX_AGE_MS = 30 * 60 * 1000;

function cleanStep(step) {
  return step === "plan" || step === "shop" || step === "add" ? step : "";
}

/**
 * @param {{ items?: object[], plan?: object | null, step?: string, scroll?: number, store?: string, kind?: string, at?: number }} input
 */
export function handoffTripRecord(input = {}, at = Date.now()) {
  const step = cleanStep(input.step) || "plan";
  const kind = input.kind === "coupons" || input.kind === "cart" ? input.kind : "store";
  return {
    items: Array.isArray(input.items) ? input.items : [],
    plan: input.plan || null,
    step,
    scroll: Math.max(0, Math.floor(Number(input.scroll) || 0)),
    store: String(input.store || "").trim().slice(0, 40),
    kind,
    at: Number(input.at) || Number(at) || Date.now(),
  };
}

/** @param {{ setItem?: (key: string, value: string) => void } | null | undefined} storage */
export function writeHandoffTrip(storage, record) {
  if (!storage?.setItem || !record) return false;
  try {
    storage.setItem(HANDOFF_TRIP_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ getItem?: (key: string) => string | null } | null | undefined} storage
 * @param {number} [now]
 */
export function readHandoffTrip(storage, now = Date.now()) {
  if (!storage?.getItem) return null;
  try {
    const parsed = JSON.parse(storage.getItem(HANDOFF_TRIP_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const at = Number(parsed.at) || 0;
    if (!at || now - at > HANDOFF_TRIP_MAX_AGE_MS) return null;
    return handoffTripRecord(parsed, at);
  } catch {
    return null;
  }
}

/**
 * An empty handoff write must not erase a trip that is already saved.
 * The newer non-empty list wins. The step travels with that list.
 */
export function richerTrip(existing, incoming) {
  if (!incoming || typeof incoming !== "object") return existing || null;
  if (!existing || typeof existing !== "object") return incoming;
  const existingItems = Array.isArray(existing.items) ? existing.items : [];
  const incomingItems = Array.isArray(incoming.items) ? incoming.items : [];
  const newer = (Number(incoming.savedAt) || Number(incoming.at) || 0) >= (Number(existing.savedAt) || Number(existing.at) || 0);
  const useIncoming = incomingItems.length > 0 && (newer || existingItems.length === 0);
  const base = useIncoming ? { ...existing, ...incoming } : { ...incoming, ...existing };
  const items = incomingItems.length ? incomingItems : existingItems;
  const plan = (useIncoming ? incoming.plan : existing.plan) || incoming.plan || existing.plan || null;
  const step = cleanStep(useIncoming ? incoming.step : existing.step) || cleanStep(existing.step) || cleanStep(incoming.step) || "plan";
  return {
    ...base,
    items,
    plan,
    step,
    savedAt: Math.max(Number(existing.savedAt) || Number(existing.at) || 0, Number(incoming.savedAt) || Number(incoming.at) || 0),
  };
}

/**
 * Where a fresh page lands. Kroger's saved return wins, then the handoff
 * snapshot, then the last tab the shopper had open.
 */
export function bootTab({ krogerStep, handoffStep, hasHandoff, storedStep, idbStep } = {}) {
  const kroger = cleanStep(krogerStep);
  if (kroger) return kroger;
  const handoff = cleanStep(handoffStep);
  if (hasHandoff && handoff) return handoff;
  const stored = cleanStep(storedStep);
  if (stored && stored !== "add") return stored;
  const idb = cleanStep(idbStep);
  if (idb && idb !== "add") return idb;
  return stored || "add";
}

/**
 * @param {IDBFactory | null | undefined} factory
 * @param {object} record
 */
export async function writeTripKeepingItems(factory, record) {
  const existing = await readTripDb(factory);
  const next = richerTrip(existing, record);
  if (!next) return false;
  return writeTripDb(factory, next);
}
