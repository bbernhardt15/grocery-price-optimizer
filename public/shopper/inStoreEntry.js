/**
 * In-store opens at the top. Skeleton rows are the same height as a
 * walking line so the list does not jump when prices land.
 */

export const SHOP_ROW_MIN_PX = 64;

function escapeText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {number} itemCount */
export function inStoreSkeletonCount(itemCount) {
  const count = Math.floor(Number(itemCount) || 0);
  return Math.max(1, count || 6);
}

/**
 * @param {number} itemCount
 */
export function inStoreLayout(itemCount) {
  const count = inStoreSkeletonCount(itemCount);
  const row = { minHeight: SHOP_ROW_MIN_PX, height: SHOP_ROW_MIN_PX };
  return {
    count,
    rows: Array.from({ length: count }, () => ({ ...row })),
  };
}

/** @param {number} itemCount */
export function inStoreSkeletonHtml(itemCount) {
  const layout = inStoreLayout(itemCount);
  const rows = layout.rows
    .map(
      (row, index) =>
        `<div class="shop-skel-row" data-shop-skel="${index}" style="min-height:${row.minHeight}px;height:${row.height}px"></div>`
    )
    .join("");
  return `<div class="shop-skel" data-shop-skel-count="${layout.count}" aria-busy="true" aria-label="${escapeText("Loading the store list")}">${rows}</div>`;
}

/** Scroll target for a tab entry and the paint that follows it. */
export function inStoreEntryScroll() {
  return { x: 0, y: 0, again: "animation-frame" };
}

/**
 * @param {(x: number, y: number) => void} scrollTo
 * @param {(fn: () => void) => void} [frame]
 */
export function applyInStoreScroll(scrollTo, frame) {
  const target = inStoreEntryScroll();
  scrollTo(target.x, target.y);
  const follow = typeof frame === "function" ? frame : (fn) => fn();
  follow(() => scrollTo(target.x, target.y));
}
