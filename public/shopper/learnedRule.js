/**
 * The chosen brand rule, shown on the card after the editor closes.
 */

const LABELS = {
  brand: "Name brand",
  storeBrand: "Store brand",
  cheapestPicks: "Cheapest of my picks",
  cheapest: "Cheapest overall",
  never: "I don't buy it",
};

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {{ mode?: string }} row */
export function learnedRuleLabel(row) {
  return LABELS[row?.mode] || "Name brand";
}

/** @param {{ mode?: string, brand?: string, brands?: string[] }} row */
export function learnedRuleBrands(row) {
  const fromList = (row?.brands || []).map((brand) => String(brand || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (fromList.length) return fromList;
  const single = String(row?.brand || "").replace(/\s+/g, " ").trim();
  return single ? [single] : [];
}

/** @param {{ mode?: string, brand?: string, brands?: string[] }} row */
export function learnedRulePillHtml(row) {
  const label = learnedRuleLabel(row);
  const brands = learnedRuleBrands(row);
  const brandHtml = brands.length
    ? `<span class="rule-pill-brands">${escapeText(brands.join(", "))}</span>`
    : "";
  return `<p class="rule-pill" data-rule="${escapeText(row?.mode || "brand")}"><span class="rule-pill-check" aria-hidden="true">✓</span><span class="rule-pill-label">${escapeText(label)}</span>${brandHtml}</p>`;
}
