/**
 * A short note above a cart handoff. Grocery Gitter does not clip coupons.
 * The shopper clips them on the store's own page.
 */

import { couponPageFor } from "./coupons.js";

export const KROGER_CLIP_NOTE = "Clip your Kroger coupons first so they apply to your cart";
export const WALMART_CLIP_NOTE = "Clip your Walmart coupons first so they apply to your cart";
export const CLIP_HONESTY = "Coupons are clipped on the store's site, not by Grocery Gitter.";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeText(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} storeName
 * @param {{ url?: string, label?: string } | null | undefined} [page]
 */
export function cartCouponCallout(storeName, page) {
  const name = clean(storeName);
  const key = name.toLowerCase();
  const kroger = key.includes("kroger");
  const walmart = key.includes("walmart");
  if (!kroger && !walmart) return "";
  const lead = kroger ? KROGER_CLIP_NOTE : WALMART_CLIP_NOTE;
  const known = page && page.url ? page : couponPageFor(name);
  const url = clean(known?.url);
  const label = clean(known?.label) || (kroger ? "Kroger digital coupons" : "Walmart Cash");
  const link = url
    ? `<a class="cart-coupon-link" href="${escapeText(url)}" data-coupon-link="${escapeText(url)}" data-store-leave="${escapeText(name)}" data-leave-kind="coupons">${escapeText(label)}</a>`
    : "";
  return `<aside class="cart-coupon-callout" data-coupon-callout="${escapeText(name)}">
    <p class="cart-coupon-lead">${escapeText(lead)}</p>
    <p class="cart-coupon-honest">${escapeText(CLIP_HONESTY)}</p>
    ${link}
  </aside>`;
}
