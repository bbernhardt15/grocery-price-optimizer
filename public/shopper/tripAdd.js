/**
 * Adding a receipt is a choice, not a dump of every line at receipt quantity.
 * Usual groceries start selected. The quantity starts at one typical purchase.
 */

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

function lineTotal(line) {
  const price = Number(line?.price);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

/**
 * @param {object[] | null | undefined} lines
 * @param {{ usualFamilies?: Iterable<string> }} [options]
 */
export function buildTripAddList(lines, options = {}) {
  const usual = new Set(options.usualFamilies || []);
  const rows = (lines || []).map((line, index) => {
    const receiptQty = Math.max(1, Math.floor(Number(line?.quantity) || 1));
    const quantity = tripQuantityDefault(receiptQty);
    const name = clean(line?.brand ? `${line.brand} ${line.name}` : line?.name) || "Item";
    const family = clean(line?.family);
    const category = clean(line?.label || line?.category) || "Groceries";
    const hasFamily = Boolean(family);
    const usualHit = hasFamily && (usual.size === 0 || usual.has(family));
    return {
      index,
      name,
      label: quantityLabel(name, receiptQty),
      category,
      family,
      receiptQty,
      quantity,
      selected: usual.size ? usualHit : true,
      estimate: Math.round(lineTotal(line) * (quantity / receiptQty) * 100) / 100,
    };
  });
  const anyUsual = rows.some((row) => row.family);
  if (anyUsual && usual.size === 0) {
    return rows.map((row) => ({ ...row, selected: Boolean(row.family) }));
  }
  return rows;
}

/** @param {Array<{ selected?: boolean, estimate?: number }>} rows */
export function tripAddTotal(rows) {
  const total = (rows || []).filter((row) => row?.selected).reduce((sum, row) => sum + (Number(row.estimate) || 0), 0);
  return Math.round(total * 100) / 100;
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
              <input type="checkbox" data-trip-pick="${row.index}" ${row.selected ? "checked" : ""} />
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
  const figure = total > 0 ? `About $${total.toFixed(2)} selected` : "Select what to add";
  return `<div class="learned-trip trip-add">
    <p>Usual buys are checked. Quantities start at a typical purchase, not the whole receipt.</p>
    <p class="trip-add-total" id="trip-add-total">${escape(figure)}</p>
    ${body || `<p class="muted">Nothing to add from that.</p>`}
    <div class="choice-stack">
      <button type="button" class="primary" id="learned-add-trip">Add these items to my trip</button>
      <button type="button" class="ghost" id="learned-empty-trip">Start with an empty trip</button>
    </div>
  </div>`;
}
