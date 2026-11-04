/**
 * The page Kroger sends the shopper back to after a cart write.
 * Sent lines stay collapsed. Checkout stays on Kroger's site.
 */

export const KROGER_CHECKOUT_NOTE =
  "After you check out at Kroger, switch back to this Grocery Gitter tab and tap Finished.";

export const KROGER_BLUE = "#004f9f";

export function showSentLabel(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n === 1 ? "Show 1 item" : `Show ${n} items`;
}

export function escapeReady(value: string): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function sentItemsDetails(names: string[]): string {
  const clean = names.map((name) => String(name || "").trim()).filter(Boolean);
  if (!clean.length) return "";
  const rows = clean.map((name) => `<li>${escapeReady(name)}</li>`).join("");
  return `<details class="cart-sent"><summary>${escapeReady(showSentLabel(clean.length))}</summary><ul>${rows}</ul></details>`;
}

export function cartReadyPageBody(input: {
  summary: string;
  items: Array<{ name?: string; upc?: string }>;
  skipped?: string[];
  backHref: string;
  checkedOutHref: string;
  cartHref: string;
}): string {
  const names = (input.items || []).map((item) => String(item?.name || item?.upc || "").trim()).filter(Boolean);
  const skipped = (input.skipped || []).map((name) => String(name || "").trim()).filter(Boolean);
  const missed = skipped.length
    ? `<p>Couldn't be matched</p><ul>${skipped.map((name) => `<li>${escapeReady(name)}</li>`).join("")}</ul>`
    : "";
  return `<p class="status">${escapeReady(input.summary)}</p>
    ${sentItemsDetails(names)}
    ${missed}
    <p class="kroger-finish-note">${escapeReady(KROGER_CHECKOUT_NOTE)}</p>
    <p><a class="kroger-cart-btn" href="${escapeReady(input.cartHref)}" rel="noopener">Open Kroger cart</a></p>
    <p><a class="ready-secondary" href="${escapeReady(input.backHref)}">Back to my trip</a></p>
    <p><a class="ready-checked" href="${escapeReady(input.checkedOutHref)}">I checked out</a></p>`;
}
