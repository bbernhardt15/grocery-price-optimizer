/**
 * In-app "your cart is ready" sheet. The sent list starts collapsed.
 * Open Kroger cart is the primary action. Trip completion uses the hook
 * agent A adds when it is present, and the existing finish flow otherwise.
 */

export const KROGER_CHECKOUT_NOTE =
  "After you check out at Kroger, switch back to this Grocery Gitter tab and tap Finished.";

export function showSentLabel(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n === 1 ? "Show 1 item" : `Show ${n} items`;
}

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string[] | null | undefined} names */
export function sentItemsHtml(names) {
  const clean = (names || []).map((name) => String(name || "").trim()).filter(Boolean);
  if (!clean.length) return "";
  const rows = clean.map((name) => `<li>${escapeText(name)}</li>`).join("");
  return `<details class="cart-sent"><summary>${escapeText(showSentLabel(clean.length))}</summary><ul>${rows}</ul></details>`;
}

/**
 * Prefer a completion hook. Otherwise the caller runs the Did you finish path.
 * @param {{ completeTrip?: (detail: { store: string, source: string }) => unknown, didYouFinish?: (store: string) => unknown }} [hooks]
 * @param {string} store
 */
export async function finishCheckedOut(hooks = {}, store = "Kroger") {
  const name = String(store || "Kroger");
  const detail = { store: name, source: "i-checked-out" };
  if (typeof hooks.completeTrip === "function") {
    await hooks.completeTrip(detail);
    return "hook";
  }
  if (typeof hooks.didYouFinish === "function") {
    await hooks.didYouFinish(name);
    return "did-you-finish";
  }
  return "missing";
}

/**
 * @param {{ completeTrip?: Function, ggCompleteTrip?: Function, completeGroceryTrip?: Function }} [bag]
 */
export function completionHook(bag = {}) {
  if (typeof bag.completeTrip === "function") return bag.completeTrip;
  if (typeof bag.ggCompleteTrip === "function") return bag.ggCompleteTrip;
  if (typeof bag.completeGroceryTrip === "function") return bag.completeGroceryTrip;
  return null;
}
