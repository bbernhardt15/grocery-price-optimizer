/**
 * One row per product across photos and inside a single photo.
 * Match on a normalized name or a UPC. Quantities add.
 */

function normName(item) {
  return String(item?.name || item?.raw || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:oz|lb|lbs|ct|pk|pack|packs|count|gal|gallon|fl)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normUpc(item) {
  const raw = item?.upc || item?.choices?.[0]?.product?.upc || "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8) return "";
  return digits.replace(/^0+/, "") || digits;
}

function better(left, right) {
  const rank = (item) => (item?.status === "matched" ? 2 : item?.status === "ambiguous" ? 1 : 0);
  return rank(right) > rank(left) ? right : left;
}

export function dedupeReviewItems(items) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  const byUpc = new Map();
  const byName = new Map();
  for (const item of list) {
    if (!item) continue;
    const upc = normUpc(item);
    const name = normName(item);
    const named = name && byName.has(name) ? byName.get(name) : undefined;
    const coded = upc && byUpc.has(upc) ? byUpc.get(upc) : undefined;
    const codedName = coded == null ? "" : normName(out[coded]);
    const priorIndex = named ?? (coded != null && (!name || !codedName || codedName === name) ? coded : undefined);
    if (priorIndex == null) {
      const copy = { ...item, quantity: Math.max(1, Math.min(99, Number(item.quantity) || 1)) };
      const index = out.length;
      out.push(copy);
      if (upc) byUpc.set(upc, index);
      if (name) byName.set(name, index);
      continue;
    }
    const prior = out[priorIndex];
    const keep = better(prior, item);
    const quantity = Math.max(1, Math.min(99, (Number(prior.quantity) || 1) + (Number(item.quantity) || 1)));
    const merged = {
      ...keep,
      key: prior.key || keep.key,
      quantity,
      upc: prior.upc || item.upc,
      accepted: Boolean(prior.accepted || item.accepted) && (keep.status !== "missing" || Boolean(keep.selectedId)),
    };
    out[priorIndex] = merged;
    if (upc) byUpc.set(upc, priorIndex);
    if (name) byName.set(name, priorIndex);
  }
  return out.map((item, index) => ({ ...item, key: item.key || `item-${index + 1}` }));
}
