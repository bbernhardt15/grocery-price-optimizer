/**
 * Price checks land per store. The screen shows that list instead of a stall.
 */

/**
 * @param {string[]} stores
 * @param {Record<string, { done?: boolean, checked?: number, total?: number }>} [progress]
 */
export function planChecklist(stores, progress = {}) {
  const names = (stores || []).map((name) => String(name || "").trim()).filter(Boolean);
  const rows = names.length ? names : ["Kroger", "Walmart"];
  return rows.map((storeName) => {
    const row = progress?.[storeName] || {};
    const total = Math.max(0, Math.floor(Number(row.total) || 0));
    const checked = Math.max(0, Math.min(total || Number(row.checked) || 0, Math.floor(Number(row.checked) || 0)));
    return {
      storeName,
      done: Boolean(row.done) || (total > 0 && checked >= total),
      checked,
      total,
    };
  });
}

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {ReturnType<typeof planChecklist>} rows */
export function planChecklistHtml(rows) {
  const items = (rows || [])
    .map((row) => {
      const count = row.total > 0 ? ` ${row.checked} of ${row.total}` : "";
      const mark = row.done ? "✓" : "○";
      return `<li class="plan-check${row.done ? " is-done" : ""}" data-plan-store="${escapeText(row.storeName)}"><span aria-hidden="true">${mark}</span> ${escapeText(row.storeName)}${escapeText(count)}</li>`;
    })
    .join("");
  return `<ul class="plan-checks" id="plan-checks" aria-label="Price checks">${items}</ul>`;
}

/**
 * Keep a store's prices when a later plan omits that store but the lines are still on the list.
 * @param {object[] | null | undefined} previousStores
 * @param {object[] | null | undefined} nextStores
 * @param {string[]} wantedNames
 * @param {string[]} [unavailable]
 */
export function mergeKeptStorePrices(previousStores, nextStores, wantedNames, unavailable = []) {
  const norm = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const wanted = (wantedNames || []).map(norm).filter(Boolean);
  const blocked = new Set((unavailable || []).map(norm).filter(Boolean));
  const nameOf = (item) => norm(item?.query || item?.name);
  const stillWanted = (item) => {
    const name = nameOf(item);
    if (!name || blocked.has(name)) return false;
    if (!wanted.length) return false;
    return wanted.some((row) => row === name || row.includes(name) || name.includes(row));
  };
  const next = (nextStores || []).map((store) => ({ ...store, items: [...(store.items || [])] }));
  const seen = new Set();
  for (const store of next) {
    for (const item of store.items || []) {
      const name = nameOf(item);
      if (name && Number(item?.price) > 0) seen.add(name);
    }
  }
  for (const store of previousStores || []) {
    const kept = (store.items || []).filter((item) => {
      const name = nameOf(item);
      return stillWanted(item) && name && !seen.has(name) && Number(item?.price) > 0;
    });
    if (!kept.length) continue;
    const existing = next.find((row) => norm(row.storeName) === norm(store.storeName));
    if (existing) existing.items.push(...kept);
    else next.push({ ...store, items: kept });
    for (const item of kept) seen.add(nameOf(item));
  }
  return next
    .map((store) => {
      const items = store.items || [];
      const subtotal = Math.round(items.reduce((sum, item) => sum + Number(item.itemTotal ?? (Number(item.price) || 0) * (Number(item.quantity) || 1)), 0) * 100) / 100;
      const itemCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
      return { ...store, items, subtotal, itemCount };
    })
    .filter((store) => (store.items || []).length);
}
