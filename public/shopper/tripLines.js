/**
 * One walking row per product. Review and In-store both use this so a
 * retailer title and its shorter twin (two Head & Shoulders) are one line.
 * Different sizes and different products stay separate. Quantities add.
 */

const PACKAGING = new Set([
  "shampoo",
  "conditioner",
  "bottle",
  "bottles",
  "tube",
  "tubes",
  "pack",
  "packs",
  "jar",
  "jars",
  "can",
  "cans",
  "box",
  "boxes",
  "bag",
  "bags",
  "count",
  "ct",
  "oz",
  "fl",
  "lb",
  "lbs",
  "ml",
  "gal",
  "gallon",
]);

function clean(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sizeToken(item) {
  const raw = `${item?.size || ""} ${item?.name || ""}`;
  const match = raw.match(/\d+(?:\.\d+)?\s*(?:fl\.?\s*)?oz|\d+(?:\.\d+)?\s*(?:lb|lbs|ml|l|ct|count)\b/i);
  return match ? match[0].toLowerCase().replace(/\s+/g, "") : "";
}

function coreName(item) {
  const brand = clean(item?.brand);
  let name = clean(item?.name || item?.query);
  if (brand && name.startsWith(brand)) name = name.slice(brand.length).trim();
  const words = name.split(" ").filter((word) => word && !PACKAGING.has(word) && !/^\d+(?:\.\d+)?$/.test(word));
  return [brand, words.join(" ")].filter(Boolean).join(" ").trim();
}

function upcOf(item) {
  const digits = String(item?.upc || "").replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 8 ? digits : "";
}

function qtyOf(item) {
  const qty = Math.floor(Number(item?.quantity) || 1);
  return Math.max(1, Math.min(99, qty));
}

function sameLine(left, right) {
  const upcLeft = upcOf(left);
  const upcRight = upcOf(right);
  if (upcLeft && upcRight && upcLeft !== upcRight) return false;
  const sizeLeft = sizeToken(left);
  const sizeRight = sizeToken(right);
  if (sizeLeft && sizeRight && sizeLeft !== sizeRight) return false;
  if (upcLeft && upcRight && upcLeft === upcRight) return true;
  const nameLeft = coreName(left);
  const nameRight = coreName(right);
  return Boolean(nameLeft) && nameLeft === nameRight;
}

/**
 * @param {object[] | null | undefined} items
 * @param {Record<string, boolean>} [checks]
 */
export function dedupeTripLines(items, checks = {}) {
  const out = [];
  for (const item of items || []) {
    if (!item) continue;
    const prior = out.findIndex((row) => sameLine(row, item));
    if (prior < 0) {
      const lineId = item.lineId || "";
      out.push({
        ...item,
        quantity: qtyOf(item),
        lineIds: lineId ? [lineId] : [],
      });
      continue;
    }
    const kept = out[prior];
    const lineIds = [...new Set([...(kept.lineIds || []), item.lineId].filter(Boolean))];
    const checkedId = lineIds.find((id) => checks?.[id]);
    out[prior] = {
      ...kept,
      quantity: Math.min(99, qtyOf(kept) + qtyOf(item)),
      lineId: checkedId || kept.lineId || item.lineId,
      lineIds,
      upc: kept.upc || item.upc,
      productId: kept.productId || item.productId,
    };
  }
  return out;
}

/** @param {Array<{ items?: object[] }> | null | undefined} stores */
export function dedupeTripStores(stores, checks = {}) {
  return (stores || []).map((store) => ({
    ...store,
    items: dedupeTripLines(store.items, checks),
  }));
}

/** In-store is a walking checklist. It has no cart or send action. */
export function inStoreSendHtml() {
  return "";
}
