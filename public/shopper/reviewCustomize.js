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

function offerAmount(offer) {
  const price = Number(offer?.price ?? offer?.unitPrice ?? offer?.salePrice);
  if (Number.isFinite(price) && price >= 0) return price;
  const total = Number(offer?.itemTotal);
  return Number.isFinite(total) && total >= 0 ? total : NaN;
}

function sameLine(left, right) {
  const idA = clean(left?.lineId);
  const idB = clean(right?.lineId);
  if (idA && idB && idA === idB) return true;
  const nameA = clean(left?.name || left?.query).toLowerCase();
  const nameB = clean(right?.name || right?.query).toLowerCase();
  return Boolean(nameA && nameA === nameB);
}

function otherOffers(item, siblings) {
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
  for (const offer of item?.offers || []) add(offer.storeName, offerAmount(offer));
  for (const other of siblings || []) {
    if (!other || other === item || !sameLine(item, other)) continue;
    add(other.storeName, unitPrice(other));
    for (const offer of other.offers || []) add(offer.storeName, offerAmount(offer));
  }
  return [...map.values()].sort((a, b) => a.price - b.price || a.storeName.localeCompare(b.storeName));
}

/**
 * @param {object} item
 * @param {string} [title]
 */
export function customizeChoice(item, title, siblings) {
  const currentUnit = unitPrice(item);
  if (!Number.isFinite(currentUnit)) return null;
  const alt = otherOffers(item, siblings)[0];
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
  const list = items || [];
  const rows = list.map((item) => customizeChoice(item, titleOf?.(item), list)).filter(Boolean);
  if (!rows.length) return `<p class="muted">${escapeText(gitterSavedLine([]))}</p>`;
  const body = rows
    .map((row) => {
      const swap = row.lineId
        ? `<button type="button" class="ghost customize-switch" data-review-switch="${escapeText(row.lineId)}" data-review-store="${escapeText(row.switchStore)}">${escapeText(row.switchText)}</button>`
        : "";
      return `<div class="customize-row" data-customize-line="${escapeText(row.lineId)}">
        <p class="customize-item">${escapeText(row.title)}</p>
        <p class="customize-now">${escapeText(row.currentText)}</p>
        ${swap}
        <p class="customize-save">${escapeText(row.saveText)}</p>
      </div>`;
    })
    .join("");
  return `${body}<p class="customize-total">${escapeText(gitterSavedLine(rows))}</p>`;
}
