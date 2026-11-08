/**
 * Adding a receipt is a choice, not a dump of every line at receipt quantity.
 * Nothing starts selected. The quantity starts at one typical purchase.
 */

import { tripActionBarHtml } from "./tripActionBar.js";

export function tripQuantityDefault(quantity) {
  const qty = Math.floor(Number(quantity) || 1);
  if (!Number.isFinite(qty) || qty < 1) return 1;
  return qty <= 2 ? qty : 1;
}

/** @param {string} name @param {number} quantity */
export function quantityLabel(name, quantity) {
  const title = String(name || "Item").replace(/\s+/g, " ").trim() || "Item";
  const qty = Math.floor(Number(quantity) || 1);
  return qty > 1 ? `${title} x${qty}` : title;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/** Brand once, even when the receipt name already starts with that brand. */
export function joinBrandName(brand, name) {
  const brandText = clean(brand);
  const nameText = clean(name);
  if (!brandText) return nameText || "Item";
  if (!nameText) return brandText;
  const escaped = brandText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const repeated = new RegExp(`^(?:${escaped})(?:\\s+${escaped})*$`, "i");
  if (repeated.test(nameText)) return brandText;
  const prefix = new RegExp(`^${escaped}\\s+`, "i");
  const rest = nameText.replace(prefix, "").trim();
  return rest && rest.toLowerCase() !== nameText.toLowerCase() ? `${brandText} ${rest}` : `${brandText} ${nameText}`;
}

function lineTotal(line) {
  const price = Number(line?.price);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

/**
 * @param {object[] | null | undefined} lines
 * @param {{ usualFamilies?: Iterable<string> }} [options]
 */
export function splitPackedQuantity(name, quantity) {
  const title = clean(name);
  const packed = title.match(/^(.*?)(?:\s*[x×]\s*(\d{1,2}))$/i);
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  if (!packed?.[1]?.trim()) return { name: title || "Item", quantity: qty };
  const packedQty = Number(packed[2]);
  if (!packedQty || (qty > 1 && qty !== packedQty)) return { name: title, quantity: qty };
  return { name: packed[1].trim(), quantity: packedQty };
}

export function buildTripAddList(lines, _options = {}) {
  const rows = (lines || []).map((line, index) => {
    const joined = joinBrandName(line?.brand, line?.name);
    const packed = splitPackedQuantity(joined, line?.quantity);
    const receiptQty = packed.quantity;
    const quantity = tripQuantityDefault(receiptQty);
    const name = packed.name;
    const family = clean(line?.family);
    const category = clean(line?.label || line?.category) || "Groceries";
    return {
      index,
      name,
      label: quantityLabel(name, receiptQty),
      category,
      family,
      receiptQty,
      quantity,
      selected: false,
      estimate: Math.round(lineTotal(line) * (quantity / receiptQty) * 100) / 100,
    };
  });
  return rows.map((row) => ({ ...row, selected: false }));
}

/** @param {Array<{ selected?: boolean, estimate?: number }>} rows */
export function tripAddTotal(rows) {
  const total = (rows || []).filter((row) => row?.selected).reduce((sum, row) => sum + (Number(row.estimate) || 0), 0);
  return Math.round(total * 100) / 100;
}

export const EMPTY_TRIP_TOTAL = "Select items to add";

/**
 * Nothing selected reads as an invitation, not a $0 total.
 * @param {number} total
 * @param {number | null | undefined} [selectedCount]
 */
export function tripAddStatus(total, selectedCount) {
  const count =
    selectedCount == null ? (Number(total) > 0 ? 1 : 0) : Math.max(0, Math.floor(Number(selectedCount) || 0));
  if (count < 1) return { label: EMPTY_TRIP_TOTAL, canAdd: false };
  const amount = Math.round((Number(total) || 0) * 100) / 100;
  const label =
    amount > 0 ? `About $${amount.toFixed(2)} selected` : count === 1 ? "1 item selected" : `${count} items selected`;
  return { label, canAdd: true };
}

/** @param {number} total @param {number | null | undefined} [selectedCount] */
export function tripTotalLabel(total, selectedCount) {
  return tripAddStatus(total, selectedCount).label;
}

/**
 * The jump arrow hides when the Add button is already in view.
 * @param {number} scrollTop
 * @param {number} clientHeight
 * @param {number} scrollHeight
 * @param {number} [slack]
 */
/**
 * A scroll that ends on Select all must not change the checkboxes.
 * A still finger, after the list has stopped, is a real tap.
 * @param {boolean} moved
 * @param {number} scrolledAt
 * @param {number} now
 * @param {number} [windowMs]
 */
export function tripSelectFromScroll(moved, scrolledAt, now, windowMs = 450) {
  if (moved) return false;
  const at = Number(scrolledAt) || 0;
  const clock = Number(now) || 0;
  const window = Math.max(0, Number(windowMs) || 0);
  if (at && clock >= at && clock - at < window) return false;
  return true;
}

export function jumpHidden(scrollTop, clientHeight, scrollHeight, slack = 24) {
  const height = Number(scrollHeight) || 0;
  const view = Number(clientHeight) || 0;
  const top = Number(scrollTop) || 0;
  const room = Math.max(0, Number(slack) || 0);
  if (height <= view + room) return true;
  return top + view >= height - room;
}

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {object[] | null | undefined} lines
 * @param {{ usualFamilies?: Iterable<string>, escapeHtml?: (value: string) => string }} [options]
 */
export function tripAddHtml(lines, options = {}) {
  const escape = options.escapeHtml || escapeText;
  const rows = buildTripAddList(lines, options);
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.category)) groups.set(row.category, []);
    groups.get(row.category).push(row);
  }
  const total = tripAddTotal(rows);
  const selectedCount = rows.filter((row) => row.selected).length;
  const status = tripAddStatus(total, selectedCount);
  const body = [...groups.entries()]
    .map(([category, group]) => {
      const items = group
        .map((row) => {
          const note =
            row.receiptQty > row.quantity
              ? `<span class="muted">Receipt had ${row.receiptQty}. This trip adds ${row.quantity}.</span>`
              : "";
          const price = row.estimate > 0 ? `<span class="trip-add-price">${escape(`$${row.estimate.toFixed(2)}`)}</span>` : "";
          return `<li class="trip-add-row">
            <label class="check-line">
              <input type="checkbox" data-trip-pick="${row.index}" data-estimate="${row.estimate}" ${row.selected ? "checked" : ""} />
              <span class="trip-add-name">${escape(row.label)}</span>
            </label>
            ${note}
            <span class="stepper">
              <button type="button" data-trip-qty-step="${row.index}" data-dir="-1" aria-label="Decrease ${escape(row.name)}">−</button>
              <input data-trip-qty="${row.index}" inputmode="numeric" value="${row.quantity}" aria-label="Quantity for ${escape(row.name)}" />
              <button type="button" data-trip-qty-step="${row.index}" data-dir="1" aria-label="Increase ${escape(row.name)}">+</button>
            </span>
            ${price}
          </li>`;
        })
        .join("");
      return `<section class="trip-add-group"><h3>${escape(category)}</h3><ul>${items}</ul></section>`;
    })
    .join("");
  const disabled = status.canAdd ? "" : " disabled";
  return `<div class="learned-trip trip-add">
    ${tripActionBarHtml({ count: selectedCount, canAdd: status.canAdd, escapeHtml: escape })}
    <div class="trip-add-body" id="trip-add-body">
      <p class="trip-add-total" id="trip-add-total">${escape(status.label)}</p>
      ${body || `<p class="muted">Nothing to add from that.</p>`}
      <button type="button" class="trip-jump" id="trip-jump" aria-label="Jump to Add" hidden>↓</button>
      <div class="choice-stack" id="trip-add-end">
        <button type="button" class="primary" data-trip-add="1" id="learned-add-trip"${disabled}>Add these items to my trip</button>
        <button type="button" class="ghost" id="learned-empty-trip">Start with an empty trip</button>
      </div>
    </div>
  </div>`;
}
