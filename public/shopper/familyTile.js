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
export function listItemTitle(product) {
  const title = String(product?.familyName || product?.name || "Item").trim() || "Item";
  const variant = String(product?.variantLabel || product?.sizeLabel || "").trim();
  const brand = String(product?.brand || "").trim();
  const showBrand = brand.length > 0 && !title.toLowerCase().includes(brand.toLowerCase());
  const detail = [showBrand ? brand : "", variant].filter((part) => part.length > 0).join(" · ");
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
