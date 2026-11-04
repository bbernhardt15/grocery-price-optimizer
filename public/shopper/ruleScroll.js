/**
 * Closing a brand-rule editor re-renders the card. The page scroll
 * from before that render is the one to keep.
 */

function whole(value) {
  const n = Math.floor(Number(value) || 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * @param {{ stage?: number, sheet?: number, page?: number }} [input]
 */
export function captureRuleScroll(input = {}) {
  return {
    stage: whole(input.stage),
    sheet: whole(input.sheet),
    page: whole(input.page),
  };
}

/**
 * @param {{ stage?: { scrollTop: number } | null, sheet?: { scrollTop: number } | null, scrollTo?: (y: number) => void, frame?: (fn: () => void) => void }} nodes
 * @param {{ stage: number, sheet: number, page: number }} saved
 */
export function restoreRuleScroll(nodes, saved) {
  const apply = () => {
    if (nodes?.stage) nodes.stage.scrollTop = saved.stage;
    if (nodes?.sheet) nodes.sheet.scrollTop = saved.sheet;
    if (typeof nodes?.scrollTo === "function") nodes.scrollTo(saved.page);
  };
  apply();
  if (typeof nodes?.frame === "function") nodes.frame(apply);
  return saved;
}

/**
 * Move only the scrolling container. A window scrollIntoView jumps the page.
 * @param {number} containerTop
 * @param {number} containerHeight
 * @param {number} childTop
 * @param {number} childBottom
 * @param {number} scrollTop
 */
export function revealDelta(containerTop, containerHeight, childTop, childBottom, scrollTop) {
  const top = Number(containerTop) || 0;
  const height = Math.max(0, Number(containerHeight) || 0);
  const start = Number(childTop) || 0;
  const end = Number(childBottom) || 0;
  const current = whole(scrollTop);
  if (start >= top && end <= top + height) return current;
  return Math.max(0, current + (start - top - 8));
}

/**
 * @param {{ getBoundingClientRect?: () => { top: number, bottom: number, height?: number }, clientHeight?: number, scrollTop: number } | null | undefined} container
 * @param {{ getBoundingClientRect?: () => { top: number, bottom: number } } | null | undefined} child
 */
export function revealInside(container, child) {
  if (!container || !child || typeof container.getBoundingClientRect !== "function" || typeof child.getBoundingClientRect !== "function") {
    return false;
  }
  const box = container.getBoundingClientRect();
  const item = child.getBoundingClientRect();
  const next = revealDelta(box.top, container.clientHeight || box.height || 0, item.top, item.bottom, container.scrollTop);
  if (next === container.scrollTop) return false;
  container.scrollTop = next;
  return true;
}
