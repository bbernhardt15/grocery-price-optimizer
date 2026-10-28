/**
 * Shopper-facing labels for a product family tile.
 * The list shows the family (Coca-Cola, Doritos Cool Ranch) plus the
 * size the shopper picked (12 pk · 12 fl oz cans). The catalog id stays
 * the variant's master product id.
 */

/**
 * @param {{ familyName?: string, name?: string, brand?: string, variantLabel?: string, sizeLabel?: string } | null | undefined} product
 * @returns {{ title: string, detail: string }}
 */
function cleanLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeLabel(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shoutingWord(word) {
  const letters = word.replace(/[^A-Za-z]/g, "");
  return letters.length >= 4 && letters === letters.toUpperCase();
}

function soften(value) {
  return value.replace(/[A-Za-z0-9][A-Za-z0-9']*/g, (word) => {
    if (!shoutingWord(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

/**
 * Drop a brand that is repeated at the front of a name, and quiet
 * ALL CAPS brand tokens. "Gerber Gerber Juice" and "GERBER Pear juice"
 * both read as Gerber products. Mixed-case names stay as written.
 * @param {string | null | undefined} name
 * @param {string | null | undefined} [brand]
 */
export function displayProductName(name, brand) {
  let title = cleanLabel(name);
  if (!title) return "";
  const brandClean = cleanLabel(brand);
  if (!brandClean) return soften(title);
  const boundary = new RegExp(`^${escapeLabel(brandClean)}(?=\\s|$)`, "i");
  let rest = title;
  let count = 0;
  while (boundary.test(rest) && count < 4) {
    count += 1;
    rest = rest.replace(boundary, "").trim();
  }
  if (count >= 1) title = `${soften(brandClean)} ${soften(rest)}`.trim();
  else title = soften(title);
  return title.replace(/\s+/g, " ").trim();
}

export function listItemTitle(product) {
  const raw = String(product?.familyName || product?.name || "Item").trim() || "Item";
  const title = displayProductName(raw, product?.brand) || "Item";
  const variant = String(product?.variantLabel || product?.sizeLabel || "").trim();
  const brand = String(product?.brand || "").trim();
  const showBrand = brand.length > 0 && !title.toLowerCase().includes(brand.toLowerCase());
  const detail = [showBrand ? displayProductName(brand, brand) : "", variant].filter((part) => part.length > 0).join(" · ");
  return { title, detail };
}

/**
 * Quantity staged on a tile before Add. Stays in 1–99.
 * @param {number | string | null | undefined} current
 * @param {number} delta
 */
export function stagedQuantity(current, delta) {
  const base = Number(current);
  const start = Number.isFinite(base) && base >= 1 ? Math.floor(base) : 1;
  const step = Number.isFinite(delta) ? delta : 0;
  return Math.min(99, Math.max(1, start + step));
}
