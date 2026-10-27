/**
 * In-store checklist: store, then the aisle order already used for a trip.
 * Checks and the last plan live on the device so the list still opens offline.
 */

import { groupForAisle, readTripSnapshot } from "./tripPlan.js";

/**
 * @param {Array<{ storeName: string, subtotal?: number, items?: object[] }>} stores
 */
export function shopSections(stores) {
  return (stores || [])
    .filter((store) => (store.items || []).length)
    .map((store) => ({
      storeName: store.storeName,
      subtotal: store.subtotal,
      groups: groupForAisle(store.items || []),
    }));
}

/**
 * @param {Array<{ items?: Array<{ lineId?: string }> }>} stores
 * @param {Record<string, boolean>} checks
 */
export function shopProgress(stores, checks) {
  const items = (stores || []).flatMap((store) => store.items || []);
  const total = items.length;
  const done = items.filter((item) => item?.lineId && checks?.[item.lineId]).length;
  return {
    total,
    done,
    left: Math.max(0, total - done),
    complete: total > 0 && done === total,
  };
}

/** @param {{ complete?: boolean, total?: number } | null | undefined} progress */
export function doneMessage(progress) {
  if (!progress?.complete) return null;
  return {
    title: "You're done",
    body: "Everything on this trip is checked off.",
  };
}

/**
 * Other packs already priced on this line. Nothing new is invented.
 * @param {{ name?: string, storeName?: string, offers?: object[] }} item
 */
export function swapChoices(item) {
  const currentName = String(item?.name || "");
  const currentStore = String(item?.storeName || "");
  const choices = [];
  for (const offer of item?.offers || []) {
    if (!offer?.storeName) continue;
    const name = String(offer.name || currentName);
    const sameItem = offer.storeName === currentStore && name === currentName && offer.matchKind !== "swap" && offer.matchKind !== "substitute";
    if (sameItem) continue;
    const price = Number(offer.price);
    choices.push({
      storeName: offer.storeName,
      name,
      price: Number.isFinite(price) ? price : null,
    });
  }
  return choices;
}

/**
 * @param {{ lineId?: string }} item
 * @param {Record<string, boolean>} checks
 */
export function rowChecked(item, checks) {
  return Boolean(item?.lineId && checks?.[item.lineId]);
}

/**
 * Last plan saved on this device, or null when there isn't one.
 * @param {{ getItem: (key: string) => string | null } | null | undefined} storage
 */
export function cachedTrip(storage) {
  const saved = readTripSnapshot(storage);
  if (!saved?.payload?.stores?.length) return null;
  return {
    payload: saved.payload,
    edits: {
      lockedStore: saved.edits?.lockedStore || null,
      moves: { ...(saved.edits?.moves || {}) },
      fewerStops: Boolean(saved.edits?.fewerStops),
    },
  };
}
