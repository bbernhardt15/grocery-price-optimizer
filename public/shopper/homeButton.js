/**
 * The G mark is home. It closes whatever sheet is open, then shows Add.
 * A proxy sits in the top layer while a modal sheet has made the header inert.
 */

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

/** @param {number} openDialogCount */
export function homeProxyShouldShow(openDialogCount) {
  return Number(openDialogCount) > 0;
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
