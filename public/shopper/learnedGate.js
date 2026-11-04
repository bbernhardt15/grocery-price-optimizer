/**
 * The learned screen is one paint, after parsing and brand grouping
 * have both finished and the reading spinner has been dismissed.
 * A partial list is not a screen. It is not inserted, then removed.
 */

/** @param {{ parsing?: boolean, grouping?: boolean, revealed?: boolean } | null | undefined} state */
export function learnedViewReady(state) {
  if (!state) return false;
  if (state.parsing || state.grouping) return false;
  return state.revealed === true;
}

/**
 * Spinner markup while loading. Learned markup only once the gate is open.
 * Loading frames never include the learned view, even if a caller already
 * built that HTML.
 * @param {{ parsing?: boolean, grouping?: boolean, revealed?: boolean, spinnerHtml?: string, learnedHtml?: string } | null | undefined} state
 */
export function importStageHtml(state) {
  if (!learnedViewReady(state)) return String(state?.spinnerHtml || "");
  return String(state?.learnedHtml || "");
}

/**
 * Paint each frame in order. Returns which screen was actually in the DOM
 * after every frame, so a test can see that learned never appears early.
 * @param {HTMLElement} root
 * @param {Array<{ parsing?: boolean, grouping?: boolean, revealed?: boolean, spinnerHtml?: string, learnedHtml?: string }>} frames
 */
export function paintImportSequence(root, frames) {
  const seen = [];
  for (const frame of frames || []) {
    const html = importStageHtml(frame);
    if (!learnedViewReady(frame) && /learned-summary|Here's what we learned/i.test(html)) {
      throw new Error("learned markup during loading");
    }
    root.innerHTML = html;
    const learned = root.querySelector(".learned-summary");
    const visible = Boolean(learned) && learned.getClientRects().length > 0 && getComputedStyle(learned).display !== "none" && getComputedStyle(learned).visibility !== "hidden";
    seen.push(visible ? "learned" : "reading");
  }
  return seen;
}
