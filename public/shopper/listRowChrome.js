/**
 * Shopping list rows. An empty image used to paint a square outline beside the
 * real checkbox. No picture means no box.
 */

import { productPhotoHtml } from "./productPhoto.js";

export { PUSH_ALERT_COPY as LIST_ALERT_BENEFIT } from "./alertDelivery.js";

/** @param {string | null | undefined} url */
export function listThumbHtml(url) {
  return productPhotoHtml(url);
}

/** @param {boolean} on */
export function listAlertStateLabel(on) {
  return on ? "On" : "Off";
}
