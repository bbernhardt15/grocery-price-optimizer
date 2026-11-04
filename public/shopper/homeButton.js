/**
 * The G mark is home. It closes whatever sheet is open, then shows Add.
 * The mark stays in the header flow, with the Grocery Gitter wordmark.
 * Sheets get the same row inside the sheet, never a floating proxy.
 */

export const WORDMARK = "Grocery Gitter";

export function sheetBrandHtml() {
  return `<button type="button" class="sheet-brand" data-sheet-home aria-label="Grocery Gitter home"><span class="brand-mark" aria-hidden="true">G</span><span class="brand-word">${WORDMARK}</span></button>`;
}

/**
 * @param {string[] | null | undefined} openDialogIds
 */
export function homeTransition(openDialogIds) {
  return {
    closeDialogIds: (openDialogIds || []).map((id) => String(id || "")).filter(Boolean),
    step: "add",
    reason: "user",
  };
}

/** A floating G is never shown. The count is ignored on purpose. */
export function homeProxyShouldShow(_openDialogCount) {
  return false;
}

/**
 * @param {HTMLElement | { style: Record<string, string> } | null | undefined} button
 * @param {{ top: number, left: number, width: number, height: number } | null | undefined} rect
 */
export function placeHomeProxy(button, rect) {
  if (!button?.style || !rect) return false;
  button.style.top = `${Math.round(rect.top)}px`;
  button.style.left = `${Math.round(rect.left)}px`;
  button.style.width = `${Math.max(42, Math.round(rect.width))}px`;
  button.style.height = `${Math.max(42, Math.round(rect.height))}px`;
  return true;
}
