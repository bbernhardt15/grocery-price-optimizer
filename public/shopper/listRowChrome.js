/**
 * Shopping list rows. An empty image used to paint a square outline beside the
 * real checkbox. No picture means no box.
 */

export { PUSH_ALERT_COPY as LIST_ALERT_BENEFIT } from "./alertDelivery.js";

/** @param {string | null | undefined} url @param {(value: string) => string} escape */
export function listThumbHtml(url, escape) {
  const src = String(url || "").trim();
  if (!src) return `<span class="product-placeholder" aria-hidden="true"></span>`;
  const safe = typeof escape === "function" ? escape(src) : src;
  return `<img data-photo="product" src="${safe}" alt="" />`;
}

/** @param {boolean} on */
export function listAlertStateLabel(on) {
  return on ? "On" : "Off";
}
