/**
 * My list rows. An empty image used to paint a square outline beside the
 * real checkbox. No picture means no box.
 */

export const LIST_ALERT_BENEFIT = "We'll notify you when something on your list gets cheaper.";

/** @param {string | null | undefined} url @param {(value: string) => string} escape */
export function listThumbHtml(url, escape) {
  const src = String(url || "").trim();
  if (!src) return "";
  const safe = typeof escape === "function" ? escape(src) : src;
  return `<img src="${safe}" alt="" />`;
}

/** @param {boolean} on */
export function listAlertStateLabel(on) {
  return on ? "On" : "Off";
}
