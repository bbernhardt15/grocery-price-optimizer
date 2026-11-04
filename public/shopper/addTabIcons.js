/**
 * Add-tab glyphs and the inline loader.
 * Icons share one 24px viewBox with artwork inset so a 44px tile
 * keeps padding and nothing paints outside the rounded box.
 */

function svg(body) {
  return `<svg class="feature-svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${body}</svg>`;
}

/** Two stacked lists. The lines are cut out of the tile color so the mark stays bold. */
export const ICON_THEMED = svg(
  `<rect x="7.2" y="3.2" width="12.2" height="13.2" rx="2.2" fill="currentColor" opacity="0.45"/><rect x="4.2" y="7.2" width="12.6" height="13.4" rx="2.2" fill="currentColor"/><path d="M6.8 11.2h7.2M6.8 14h7.2M6.8 16.8h4.4" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/>`
);

/** Receipt with a zigzag foot, inset so the teeth stay inside the tile. */
export const ICON_RECEIPT = svg(
  `<path fill="currentColor" d="M7 3.4h10.2a1 1 0 0 1 1 1V19.2l-2-1.35-1.9 1.35-1.8-1.35L10.6 19.2 8.8 17.85 6.8 19.2V4.4a1 1 0 0 1 1-1z"/><path d="M9.2 8h6M9.2 11.1h6M9.2 14.2h3.6" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/>`
);

/** Centered spinner. The ring spins on an inner element so placement stays put. */
export function inlineLoaderHtml() {
  return `<span class="inline-loader" aria-hidden="true"><span></span></span>`;
}

/** Three bars for a shelf or list that has not arrived yet. */
export function shelfSkeletonHtml(label = "Loading") {
  const name = String(label || "Loading").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
  return `<div class="theme-skel" aria-busy="true" aria-label="${name}"><span></span><span></span><span></span></div>`;
}
