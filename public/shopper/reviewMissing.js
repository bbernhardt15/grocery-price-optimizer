/**
 * Items the plan could not price. Collapsed, with a few catalog swaps.
 * No extra model call: the line is the short sentence already used here.
 */

export const MISSING_LINE = "These didn't match a product we can price. A close match is usually the same brand, or another flavor or size.";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tokens(value) {
  return clean(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
}

function escapeText(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function missingHeading(count) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  if (total === 1) return "1 item we couldn't find";
  return `${total} items we couldn't find`;
}

/**
 * Same brand first, then shared words (flavor, scent, size). At most three.
 * @param {string} requested
 * @param {object[]} products
 * @param {number} [limit]
 */
export function rankSwapSuggestions(requested, products, limit = 3) {
  const want = tokens(requested);
  const asked = clean(requested).toLowerCase();
  const ranked = [];
  for (const product of products || []) {
    const brand = clean(product?.brand);
    const name = clean(product?.name || product?.familyName);
    if (!name) continue;
    const hay = tokens(`${brand} ${name} ${product?.sizeLabel || product?.size || ""}`);
    const shared = want.filter((word) => hay.includes(word)).length;
    const sameBrand = Boolean(brand) && asked.includes(brand.toLowerCase());
    if (!sameBrand && shared === 0) continue;
    const price = Number(product?.bestOffer?.price ?? product?.price);
    ranked.push({
      product,
      sameBrand,
      score: shared + (sameBrand ? 3 : 0),
      price: Number.isFinite(price) ? price : null,
    });
  }
  ranked.sort((a, b) => Number(b.sameBrand) - Number(a.sameBrand) || b.score - a.score || (a.price ?? 9999) - (b.price ?? 9999));
  const cap = Math.max(1, Math.min(3, Math.floor(Number(limit) || 3)));
  return ranked.slice(0, cap);
}

function money(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

/**
 * @param {string[]} names
 * @param {Record<string, Array<{ id?: string, name?: string, brand?: string, price?: number }>>} suggestions
 */
export function missingAccordionHtml(names, suggestions = {}) {
  const list = (names || []).map((name) => clean(name)).filter(Boolean);
  if (!list.length) return "";
  const rows = list
    .map((name) => {
      const picks = suggestions[name] || [];
      const buttons = picks.length
        ? picks
            .map((pick) => {
              const label = clean(pick.name) || "Similar item";
              const price = money(pick.price);
              return `<button type="button" class="swap-suggestion" data-missing-swap="${escapeText(pick.id || "")}" data-missing-for="${escapeText(name)}">${escapeText(label)}${price ? ` · ${escapeText(price)}` : ""}</button>`;
            })
            .join("")
        : `<p class="muted" data-missing-pending="${escapeText(name)}">Looking for a close match…</p>`;
      return `<li class="missing-row">
        <p>${escapeText(name)}</p>
        <div class="swap-suggestions" data-missing-suggest="${escapeText(name)}">${buttons}</div>
        <button type="button" class="text-btn" data-missing-remove="${escapeText(name)}">Remove</button>
      </li>`;
    })
    .join("");
  return `<details class="missing-fold">
    <summary>${escapeText(missingHeading(list.length))}</summary>
    <p class="missing-line">${escapeText(MISSING_LINE)}</p>
    <ul class="missing-list">${rows}</ul>
  </details>`;
}
