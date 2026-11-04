/**
 * Shopping list sheet copy and the price-alert control.
 * The switch is shown only when the server can actually send a push.
 */

export const SHOPPING_LIST_PURPOSE = "Edit quantities, remove what you don't need, and share this trip's list.";
export const SUB_SWAP_LABEL = "OK to swap for similar items";
export const SUB_SWAP_NOTE = "If a store is missing an item, the plan can use a similar product there instead of adding another stop.";
export const SHARE_BUTTON_LABEL = "Share";

/**
 * @param {{ visible?: boolean, mode?: string, disabled?: boolean } | null | undefined} state
 */
export function alertControlVisible(state) {
  return Boolean(state && state.visible && state.mode === "push" && state.disabled !== true);
}

/**
 * @param {string} itemId
 * @param {string} title
 * @param {(value: string) => string} escape
 */
export function listRemoveHtml(itemId, title, escape) {
  const safe = typeof escape === "function" ? escape : (value) => String(value ?? "");
  return `<button type="button" class="text-btn list-remove" data-list-remove="${safe(itemId)}" aria-label="Remove ${safe(title)}">Remove</button>`;
}
