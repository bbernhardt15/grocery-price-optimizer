/**
 * A finished trip becomes a short receipt: stores, totals, savings, and the date.
 * The item list stays tucked away until someone opens it. Reuse shops it again.
 */

import { ICON_RECEIPT } from "./addTabIcons.js";

const KEY = "gg-past-trips";
const MAX_TRIPS = 24;

function clean(value, max = 80) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function money(cents) {
  const amount = Math.round(Number(cents) || 0) / 100;
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Cents from a line price. A missing price is 0, not a made-up number. */
export function lineEstimateCents(item) {
  const qty = Math.max(1, Math.floor(Number(item?.quantity) || 1));
  const itemTotal = Number(item?.itemTotal);
  if (Number.isFinite(itemTotal) && itemTotal > 0) return Math.round(itemTotal * 100);
  const price = Number(item?.price);
  if (Number.isFinite(price) && price > 0) return Math.round(price * qty * 100);
  return 0;
}

/** Store subtotal when it is priced, otherwise the sum of priced lines. */
export function storeEstimateCents(store) {
  const sub = Number(store?.subtotal);
  if (Number.isFinite(sub) && sub > 0) return Math.round(sub * 100);
  return (store?.items || []).reduce((sum, item) => sum + lineEstimateCents(item), 0);
}

/**
 * @param {{
 *   stores?: Array<{ storeName?: string, subtotal?: number, items?: object[] }>,
 *   total?: number,
 *   savedCents?: number,
 *   at?: number,
 *   id?: string,
 * }} input
 */
function isCentsReceipt(input) {
  if (!input || typeof input !== "object") return false;
  if (input.totalCents != null) return true;
  return (input.stores || []).some((store) => store && store.totalCents != null);
}

function centsReceipt(input) {
  const at = Number(input.at) > 0 ? Math.floor(Number(input.at)) : Date.now();
  const stores = (input.stores || [])
    .map((store) => {
      const items = (store.items || [])
        .map((item) => ({
          name: clean(item?.name || item?.query, 80),
          quantity: Math.max(1, Math.min(99, Math.floor(Number(item?.quantity) || 1))),
        }))
        .filter((item) => item.name)
        .slice(0, 80);
      return {
        storeName: clean(store.storeName, 40),
        totalCents: Math.max(0, Math.round(Number(store.totalCents) || 0)),
        items,
      };
    })
    .filter((store) => store.storeName);
  const stated = Math.round(Number(input.totalCents) || 0);
  const fromStores = stores.reduce((sum, store) => sum + store.totalCents, 0);
  const totalCents = Math.max(0, stated > 0 ? stated : fromStores);
  const savedCents = Math.max(0, Math.round(Number(input.savedCents) || 0));
  const id = clean(input.id, 40) || `trip-${at}`;
  return { id, at, totalCents, savedCents, stores };
}

export function tripReceipt(input = {}) {
  if (isCentsReceipt(input)) return centsReceipt(input);
  const at = Number(input.at) > 0 ? Math.floor(Number(input.at)) : Date.now();
  const stores = (input.stores || [])
    .map((store) => {
      const items = (store.items || [])
        .map((item) => ({
          name: clean(item?.name || item?.query, 80),
          quantity: Math.max(1, Math.min(99, Math.floor(Number(item?.quantity) || 1))),
        }))
        .filter((item) => item.name)
        .slice(0, 80);
      const totalCents = storeEstimateCents(store);
      return {
        storeName: clean(store.storeName, 40),
        totalCents,
        items,
      };
    })
    .filter((store) => store.storeName);
  const stated = Math.round(Number(input.total) * 100);
  const fromStores = stores.reduce((sum, store) => sum + store.totalCents, 0);
  const totalCents = Math.max(0, Number.isFinite(stated) && stated > 0 ? stated : fromStores);
  const savedCents = Math.max(0, Math.round(Number(input.savedCents) || 0));
  const id = clean(input.id, 40) || `trip-${at}`;
  return { id, at, totalCents, savedCents, stores };
}

/** @param {{ getItem: (key: string) => string | null, setItem?: (key: string, value: string) => void }} storage */
export function readPastTrips(storage) {
  if (!storage?.getItem) return [];
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => tripReceipt(rowFromStored(row))).filter((row) => row.stores.length || row.totalCents > 0).slice(0, MAX_TRIPS);
  } catch {
    return [];
  }
}

function rowFromStored(row) {
  if (!row || typeof row !== "object") return {};
  return {
    id: row.id,
    at: row.at,
    total: Number(row.totalCents) / 100,
    savedCents: row.savedCents,
    stores: (row.stores || []).map((store) => ({
      storeName: store.storeName,
      subtotal: Number(store.totalCents) / 100,
      items: store.items || [],
    })),
  };
}

/** @param {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void }} storage */
export function savePastTrip(storage, receipt) {
  const next = tripReceipt(receipt);
  if (!next.stores.length && !(next.totalCents > 0)) return readPastTrips(storage);
  const existing = readPastTrips(storage).filter((row) => row.id !== next.id);
  const trips = [next, ...existing].slice(0, MAX_TRIPS);
  storage.setItem(KEY, JSON.stringify(trips));
  return trips;
}

function asReceipt(row) {
  if (!row || typeof row !== "object") return tripReceipt({});
  if (row.totalCents != null || row.stores?.some?.((store) => store?.totalCents != null)) return tripReceipt(rowFromStored(row));
  return tripReceipt(row);
}

/**
 * @param {Array<object> | null | undefined} local
 * @param {Array<object> | null | undefined} remote
 */
export function mergePastTrips(local, remote) {
  const map = new Map();
  for (const row of [...(remote || []), ...(local || [])]) {
    const trip = asReceipt(row);
    if (!trip.id || (!trip.stores.length && !(trip.totalCents > 0))) continue;
    const have = map.get(trip.id);
    if (!have || trip.at >= have.at) map.set(trip.id, trip);
  }
  return [...map.values()].sort((a, b) => b.at - a.at).slice(0, MAX_TRIPS);
}

/** @param {ReturnType<typeof tripReceipt>} receipt */
export function reuseLines(receipt) {
  const lines = [];
  for (const store of receipt?.stores || []) {
    for (const item of store.items || []) {
      if (!item?.name) continue;
      lines.push({ name: item.name, quantity: Math.max(1, Math.min(99, Math.floor(Number(item.quantity) || 1))) });
    }
  }
  return lines;
}

export function formatTripWhen(at) {
  const date = new Date(Number(at) || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {ReturnType<typeof tripReceipt>} receipt */
export function receiptCardHtml(receipt, escapeHtml = escapeText) {
  const when = formatTripWhen(receipt.at);
  const stores = (receipt.stores || [])
    .map((store) => `<li><span>${escapeHtml(store.storeName)}</span><strong>${escapeHtml(money(store.totalCents))}</strong></li>`)
    .join("");
  const items = (receipt.stores || [])
    .flatMap((store) =>
      (store.items || []).map(
        (item) =>
          `<li><span>${escapeHtml(item.name)}</span><span>× ${Math.max(1, Math.floor(Number(item.quantity) || 1))}</span></li>`
      )
    )
    .join("");
  const saved = receipt.savedCents > 0 ? `<p class="receipt-saved">Saved ${escapeHtml(money(receipt.savedCents))}</p>` : "";
  const totalLabel = receipt.totalCents > 0 ? money(receipt.totalCents) : "No price saved";
  return `<article class="trip-receipt" data-receipt="${escapeHtml(receipt.id)}">
    <header><h3>${escapeHtml(when || "Trip")}</h3><p class="receipt-estimate"><span>Estimated</span> <strong data-trip-total>${escapeHtml(totalLabel)}</strong></p></header>
    <ul class="receipt-stores">${stores}</ul>
    ${saved}
    <div class="starter-actions">
      <label class="check-row"><input type="checkbox" data-trip-select="${escapeHtml(receipt.id)}" /> Select</label>
      <button type="button" class="primary" data-reuse-trip="${escapeHtml(receipt.id)}">Reuse this list</button>
    </div>
    ${items ? `<details><summary>Items</summary><ul class="receipt-items">${items}</ul></details>` : ""}
  </article>`;
}

export function pastTripsHomeHtml(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const hint = n === 1 ? "1 saved receipt" : n > 1 ? `${n} saved receipts` : "Receipts from finished trips";
  return `<button type="button" class="feature-card" id="past-trips-open">
    <span class="feature-icon" aria-hidden="true">${ICON_RECEIPT}</span>
    <span class="feature-copy"><strong>Past trips</strong><span class="muted">${hint}</span></span>
  </button>`;
}

export function pastTripsEmptyHtml() {
  return `<div class="empty-state past-empty"><h3>No trips yet</h3><p>Finish a shop and we'll keep the receipt here for next time.</p></div>`;
}
