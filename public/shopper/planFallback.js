/**
 * The last priced snapshot, or the list itself, so Review and In-store
 * always have something to paint when a live store check times out.
 */

import { planHasDisplay, planIsShowable } from "./planCache.js";

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function unitPrice(product) {
  const best = Number(product?.bestOffer?.price);
  if (Number.isFinite(best) && best > 0) return best;
  const offers = Array.isArray(product?.offers) ? product.offers : [];
  const prices = offers.map((offer) => Number(offer?.price)).filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length) return Math.min(...prices);
  const direct = Number(product?.price);
  return Number.isFinite(direct) && direct > 0 ? direct : 0;
}

/**
 * The cards can paint, but a store that has not finished is not a savings claim.
 * pendingStores stays so Review does not treat a partial as a finished comparison.
 */
export function markDisplayed(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object") return null;
  const pending = Array.isArray(payload.pendingStores) ? payload.pendingStores.filter(Boolean) : [];
  const checks = Array.isArray(payload.pricingByStore) ? payload.pricingByStore : [];
  const coverageOpen = pending.length > 0 || checks.length === 0 || checks.some((row) => !storeCheckSettled(row));
  return {
    ...payload,
    partial: false,
    pendingStores: pending,
    coverageOpen,
    displaySettled: true,
    pricedAt: Number(payload.pricedAt) || now,
  };
}

const SETTLED_SOURCES = new Set(["seed", "live", "cached_live", "weekly_ad", "cached_weekly_ad", "mixed", "partner_feed"]);

/** A store that returned prices, including the demo catalog. A timeout is not finished. */
export function storeCheckSettled(row) {
  if (!row || typeof row !== "object") return false;
  const check = String(row.check || "");
  if (check === "timeout" || check === "error" || check === "rate_limit" || check === "budget") return false;
  if (check === "ok" || row.ok === true) return true;
  return SETTLED_SOURCES.has(String(row.source || ""));
}

/** Dollar savings, "same total", and the one-store alternative need a finished check for every store. */
export function savingsClaimAllowed(payload) {
  if (!payload || payload.partial || payload.coverageOpen) return false;
  const pending = Array.isArray(payload.pendingStores) ? payload.pendingStores : [];
  if (pending.length) return false;
  const checks = Array.isArray(payload.pricingByStore) ? payload.pricingByStore : [];
  if (!checks.length) return false;
  return checks.every((row) => storeCheckSettled(row));
}

/**
 * Prefer a priced result. A partial that already has prices beats an
 * empty final body. Intermediate snapshots are not painted by the caller.
 * @param {object | null | undefined} incoming
 * @param {object | null | undefined} partial
 * @param {number} [now]
 */
export function chooseDisplayedPlan(incoming, partial, now = Date.now()) {
  if (planIsShowable(incoming)) return markDisplayed(incoming, now);
  if (planIsShowable(partial)) return markDisplayed(partial, now);
  if (planHasDisplay(incoming)) return markDisplayed(incoming, now);
  if (planHasDisplay(partial)) return markDisplayed(partial, now);
  return null;
}

/**
 * One store group from the shopping list. Used when no store returned a price.
 * @param {Array<{ quantity?: number, itemId?: string, product?: object, name?: string }> | null | undefined} entries
 * @param {string[] | null | undefined} storeNames
 * @param {number} [now]
 */
export function listDisplayPlan(entries, storeNames, now = Date.now()) {
  const storeName = (storeNames || []).map((name) => String(name || "").trim()).find(Boolean) || "Kroger";
  const items = [];
  for (const entry of entries || []) {
    const product = entry?.product || {};
    const name = String(product.familyName || product.catalogName || product.name || entry?.name || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) continue;
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(entry?.quantity) || 1)));
    const price = unitPrice(product);
    const lineId = String(entry?.itemId || product.id || name);
    items.push({
      lineId,
      name,
      query: name,
      brand: product.brand || "",
      quantity,
      storeName,
      ...(price > 0 ? { price, itemTotal: money(price * quantity) } : {}),
    });
  }
  if (!items.length) return null;
  const subtotal = money(items.reduce((sum, item) => sum + (Number(item.itemTotal) || 0), 0));
  return markDisplayed(
    {
      total: subtotal,
      stores: [{ storeName, subtotal, itemCount: items.length, items }],
      pricingByStore: [{ storeName, check: "ok" }],
      unavailable: [],
    },
    now
  );
}
