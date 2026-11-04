/**
 * Review rows. The same product is one line. Two real requests that share
 * a short title keep a size or scent so they stay distinct.
 */

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function upcDigits(value) {
  const digits = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 8 ? digits : "";
}

function words(value) {
  return clean(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

function distinguisher(item, title) {
  const size = clean(item?.size || item?.sizeLabel);
  if (size && !title.toLowerCase().includes(size.toLowerCase())) return size;
  const have = new Set(words(title));
  const extra = [];
  const skip = new Set(["the", "and", "with", "for", "brand", "homemade"]);
  for (const word of clean(`${item?.name || ""} ${item?.query || ""}`).split(/[^A-Za-z0-9]+/)) {
    const token = word.toLowerCase();
    if (!token || token.length < 3 || have.has(token) || skip.has(token)) continue;
    extra.push(word);
    if (extra.length === 2) break;
  }
  return extra.join(" ");
}

/**
 * @param {object[] | null | undefined} items
 * @param {(item: object) => string} titleOf
 */
export function dedupeReviewLines(items, titleOf) {
  /** @type {Map<string, any>} */
  const groups = new Map();
  for (const item of items || []) {
    const upc = upcDigits(item?.upc);
    const lineId = clean(item?.lineId);
    const key = upc ? `upc:${upc}` : lineId ? `line:${lineId}` : `name:${clean(item?.query || item?.name).toLowerCase()}`;
    const qty = Math.max(1, Math.floor(Number(item?.quantity) || 1));
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...item, quantity: qty });
      continue;
    }
    const sameLine = lineId && lineId === clean(existing.lineId);
    if (sameLine || !upc) existing.quantity = Math.max(existing.quantity, qty);
    else {
      const added = Number.isFinite(Number(item?.itemTotal))
        ? Number(item.itemTotal)
        : (Number(item?.price) || 0) * qty;
      const held = Number.isFinite(Number(existing.itemTotal))
        ? Number(existing.itemTotal)
        : (Number(existing.price) || 0) * (Number(existing.quantity) || 1);
      existing.quantity += qty;
      existing.itemTotal = Math.round((held + added) * 100) / 100;
    }
  }
  const titled = [...groups.values()].map((item) => ({
    ...item,
    title: clean(titleOf?.(item)) || clean(item?.name) || "Item",
  }));
  const counts = new Map();
  for (const row of titled) counts.set(row.title, (counts.get(row.title) || 0) + 1);
  return titled.map((row) => {
    if ((counts.get(row.title) || 0) < 2) return row;
    const extra = distinguisher(row, row.title);
    return extra ? { ...row, title: `${row.title} · ${extra}` } : row;
  });
}
