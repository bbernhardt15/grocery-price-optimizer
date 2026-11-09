/**
 * In-store checklist: store, then the aisle order already used for a trip.
 * Checks and the last plan live on the device so the list still opens offline.
 */

import { groupForAisle, readTripSnapshot } from "./tripPlan.js";

/** Walking order for a store whose aisle numbers we do not have. */
export const WALK_ORDER = [
  { id: "produce", label: "Produce", departments: ["Produce"] },
  { id: "bakery", label: "Bakery", departments: ["Bakery"] },
  { id: "deli", label: "Deli", departments: ["Deli"] },
  { id: "meat", label: "Meat", departments: ["Meat & Seafood"] },
  { id: "dairy", label: "Dairy", departments: ["Dairy & Eggs"] },
  { id: "center", label: "Center store", departments: ["Pantry", "Snacks", "Beverages", "Breakfast", "Baby", "Household", "Personal Care", "Pet"] },
  { id: "frozen", label: "Frozen", departments: ["Frozen"] },
  { id: "checkout", label: "Checkout", departments: ["Other"] },
];

export const LAYOUT_NOTE = "Typical layout, aisle numbers vary";

/** @param {{ aisle?: string, aisleKnown?: boolean } | null | undefined} item */
export function aisleIsKnown(item) {
  if (item?.aisleKnown) return true;
  return /^aisle\b/i.test(String(item?.aisle || ""));
}

function departmentLabel(item) {
  const name = String(item?.department || "").replace(/\s+/g, " ").trim();
  return name || "Other";
}

function walkBucket(department) {
  const name = String(department || "Other");
  return WALK_ORDER.find((row) => row.departments.includes(name)) || WALK_ORDER[WALK_ORDER.length - 1];
}

/** A merged duplicate remembers every line id that was collapsed into it. */
function lineChecked(item, checks) {
  const ids = Array.isArray(item?.lineIds) && item.lineIds.length ? item.lineIds : [item?.lineId];
  return ids.some((id) => id && checks?.[id]);
}

/**
 * Numbered walking route. Known Kroger aisles stay in aisle order.
 * A guess uses the typical department walk and says so.
 * Checked lines leave the route and sit in an In cart group.
 * @param {Array<{ storeName: string, subtotal?: number, items?: object[] }>} stores
 * @param {Record<string, boolean>} [checks]
 */
export function inStoreRoute(stores, checks = {}) {
  return (stores || [])
    .filter((store) => (store.items || []).length)
    .map((store) => {
      const open = [];
      const cart = [];
      for (const item of store.items || []) {
        if (lineChecked(item, checks)) cart.push(item);
        else open.push(item);
      }
      const known = open.some((item) => aisleIsKnown(item)) || (store.items || []).some((item) => aisleIsKnown(item));
      /** @type {Array<{ label: string, items: object[] }>} */
      const groups = [];
      if (known) {
        const sorted = [...open].sort((a, b) => departmentLabel(a).localeCompare(departmentLabel(b)) || String(a.aisle || "zzz").localeCompare(String(b.aisle || "zzz"), undefined, { numeric: true }) || String(a.name || "").localeCompare(String(b.name || "")));
        for (const item of sorted) {
          const dept = departmentLabel(item);
          const aisle = aisleIsKnown(item) ? String(item.aisle || "").trim() : "";
          const label = dept !== "Other" && aisle ? `${dept} · ${aisle}` : aisle || dept;
          const last = groups[groups.length - 1];
          if (last && last.label === label) last.items.push(item);
          else groups.push({ label, items: [item] });
        }
      } else {
        const byDept = new Map();
        for (const item of open) {
          const label = departmentLabel(item);
          if (!byDept.has(label)) byDept.set(label, []);
          byDept.get(label).push(item);
        }
        const ordered = [];
        for (const bucket of WALK_ORDER) {
          for (const name of bucket.departments) {
            if (byDept.has(name)) ordered.push(name);
          }
        }
        for (const label of byDept.keys()) {
          if (!ordered.includes(label)) ordered.push(label);
        }
        for (const label of ordered) {
          const items = byDept
            .get(label)
            .slice()
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
          if (items.length) groups.push({ label, items });
        }
      }
      let number = 0;
      const numbered = groups.map((group) => ({
        label: group.label,
        items: group.items.map((item) => {
          number += 1;
          return { ...item, routeNumber: number };
        }),
      }));
      return {
        storeName: store.storeName,
        subtotal: store.subtotal,
        known,
        note: known ? "" : LAYOUT_NOTE,
        groups: numbered,
        cart,
        left: open.length,
      };
    });
}

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
  const done = items.filter((item) => lineChecked(item, checks)).length;
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
  return lineChecked(item, checks);
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
