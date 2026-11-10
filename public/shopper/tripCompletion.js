/**
 * A finished trip is a Past trips receipt plus an empty current list.
 * Restore must not put that list back.
 */

import { richerTrip } from "./handoffRestore.js";

export const COMPLETED_TRIP_KEY = "gg-trip-completed";

/** @param {{ setItem?: (key: string, value: string) => void } | null | undefined} storage */
export function writeCompletedTrip(storage, at = Date.now()) {
  const when = Number(at) || Date.now();
  storage?.setItem?.(COMPLETED_TRIP_KEY, JSON.stringify({ at: when }));
  return when;
}

/** @param {{ getItem?: (key: string) => string | null } | null | undefined} storage */
export function readCompletedAt(storage) {
  if (!storage?.getItem) return 0;
  try {
    const parsed = JSON.parse(storage.getItem(COMPLETED_TRIP_KEY) || "null");
    const at = Number(parsed?.at);
    return Number.isFinite(at) && at > 0 ? at : 0;
  } catch {
    return 0;
  }
}

/** @param {{ removeItem?: (key: string) => void } | null | undefined} storage */
export function clearCompletedTrip(storage) {
  storage?.removeItem?.(COMPLETED_TRIP_KEY);
}

/**
 * True when this saved record is the trip the shopper already finished.
 * @param {{ items?: unknown[], savedAt?: number, at?: number, completedAt?: number } | null | undefined} record
 * @param {number} completedAt
 */
export function restoreWouldResurrect(record, completedAt) {
  const items = Array.isArray(record?.items) ? record.items : [];
  if (!items.length) return false;
  const marker = Math.max(Number(completedAt) || 0, Number(record?.completedAt) || 0);
  if (!marker) return false;
  const savedAt = Number(record?.savedAt) || Number(record?.at) || 0;
  if (!savedAt) return true;
  return savedAt <= marker;
}

/**
 * IndexedDB and the handoff snapshot. A completed marker wins over an older list.
 * @param {object | null | undefined} idb
 * @param {object | null | undefined} handoff
 * @param {number} completedAt
 */
export function restoreActiveTrip(idb, handoff, completedAt) {
  const merged = richerTrip(idb, handoff);
  if (restoreWouldResurrect(merged, completedAt)) return null;
  if (restoreWouldResurrect(idb, completedAt) && !(Number(handoff?.savedAt || handoff?.at) > Number(completedAt))) return null;
  return merged;
}
