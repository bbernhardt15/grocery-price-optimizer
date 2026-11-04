/**
 * Customize rows in plain language: where the item is, what the other
 * store charges, and whether staying put saves money.
 */

import { formatMoney } from "./savingsMeter.js";
import { normalizeStoreKey, roundMoney } from "./tripPlan.js";
import { unitPrice } from "./reviewPlans.js";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeText(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function otherOffers(item) {
  const here = normalizeStoreKey(item?.storeName);
  const map = new Map();
  const add = (storeName, price) => {
    const name = clean(storeName);
    const key = normalizeStoreKey(name);
    const amount = Number(price);
    if (!name || !key || key === here || !Number.isFinite(amount) || amount < 0) return;
    const prev = map.get(key);
    if (!prev || amount < prev.price) map.set(key, { storeName: name, price: amount });
  };
  for (const offer of item?.offers || []) add(offer.storeName, offer.price);
  return [...map.values()].sort((a, b) => a.price - b.price || a.storeName.localeCompare(b.storeName));
}

/**
 * @param {object} item
 * @param {string} [title]
 */
export function customizeChoice(item, title) {
  const currentUnit = unitPrice(item);
  if (!Number.isFinite(currentUnit) || !clean(item?.lineId)) return null;
  const alt = otherOffers(item)[0];
  if (!alt) return null;
  const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));
  const currentTotal = roundMoney(currentUnit * qty);
  const altTotal = roundMoney(alt.price * qty);
  const delta = roundMoney(altTotal - currentTotal);
  const name = clean(title) || clean(item.name) || "Item";
  let switchText = `Switch to ${alt.storeName}: ${formatMoney(altTotal)}`;
  let saveText = "";
  if (delta > 0.009) {
    switchText = `Switch to ${alt.storeName}: ${formatMoney(altTotal)} (+${formatMoney(delta)} more)`;
    saveText = `You save ${formatMoney(delta)} buying this at ${clean(item.storeName) || "this store"}`;
  } else if (delta < -0.009) {
    switchText = `Switch to ${alt.storeName}: ${formatMoney(altTotal)} (save ${formatMoney(Math.abs(delta))})`;
    saveText = `${alt.storeName} is ${formatMoney(Math.abs(delta))} less`;
  } else {
    switchText = `Switch to ${alt.storeName}: ${formatMoney(altTotal)} (same price)`;
    saveText = "Same price at both stores";
  }
  return {
    lineId: clean(item.lineId),
    title: name,
    storeName: clean(item.storeName),
    currentText: `${clean(item.storeName) || "This store"} · ${formatMoney(currentTotal)}`,
    switchStore: alt.storeName,
    switchText,
    saveText,
    saved: delta > 0 ? delta : 0,
  };
}

export function gitterSavedLine(rows) {
  const saved = roundMoney((rows || []).reduce((sum, row) => sum + (Number(row?.saved) || 0), 0));
  return `Gitter saved you ${formatMoney(saved)} vs the other store`;
}

/**
 * @param {object[]} items
 * @param {(item: object) => string} titleOf
 */
export function customizeRowsHtml(items, titleOf) {
  const rows = (items || []).map((item) => customizeChoice(item, titleOf?.(item))).filter(Boolean);
  if (!rows.length) return `<p class="muted">${escapeText(gitterSavedLine([]))}</p>`;
  const body = rows
    .map(
      (row) => `<div class="customize-row" data-customize-line="${escapeText(row.lineId)}">
        <p class="customize-item">${escapeText(row.title)}</p>
        <p class="customize-now">${escapeText(row.currentText)}</p>
        <button type="button" class="ghost customize-switch" data-review-switch="${escapeText(row.lineId)}" data-review-store="${escapeText(row.switchStore)}">${escapeText(row.switchText)}</button>
        <p class="customize-save">${escapeText(row.saveText)}</p>
      </div>`
    )
    .join("");
  return `${body}<p class="customize-total">${escapeText(gitterSavedLine(rows))}</p>`;
}
