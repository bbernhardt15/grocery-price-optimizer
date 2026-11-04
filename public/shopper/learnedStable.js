/**
 * Choosing a rule used to rebuild the whole learned list. The card node
 * was destroyed, focus fell through to a later card (Dairy & eggs), and
 * iOS Chrome scrolled that card into view after the picker closed.
 * The card element stays. The viewport scrollTop is put back exactly.
 */

function whole(value) {
  const n = Math.floor(Number(value) || 0);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** @param {Element | null | undefined} node */
export function scrollParent(node) {
  let current = node?.parentElement || null;
  const view = node?.ownerDocument?.defaultView;
  while (current && current !== node.ownerDocument?.body && current !== node.ownerDocument?.documentElement) {
    const style = view?.getComputedStyle?.(current);
    const overflow = `${style?.overflow || ""} ${style?.overflowY || ""}`;
    if (/(auto|scroll)/.test(overflow) && current.scrollHeight > current.clientHeight + 1) return current;
    current = current.parentElement;
  }
  return node?.ownerDocument?.scrollingElement || node?.ownerDocument?.documentElement || null;
}

/** @param {Document | null | undefined} doc */
export function readViewportTop(doc) {
  const scrolling = doc?.scrollingElement || doc?.documentElement;
  const win = doc?.defaultView;
  return whole(scrolling?.scrollTop ?? win?.scrollY ?? 0);
}

/** @param {Document | null | undefined} doc @param {number} top */
export function writeViewportTop(doc, top) {
  const y = whole(top);
  const scrolling = doc?.scrollingElement || doc?.documentElement;
  if (scrolling) scrolling.scrollTop = y;
  if (typeof doc?.defaultView?.scrollTo === "function") doc.defaultView.scrollTo(0, y);
  return y;
}

/**
 * @param {HTMLElement | null | undefined} card
 * @param {(card: HTMLElement) => void} update
 * @param {{ scroller?: HTMLElement | null, frame?: (fn: () => void) => void, later?: (fn: () => void) => void }} [hooks]
 */
export function commitLearnedCard(card, update, hooks = {}) {
  if (!card || typeof update !== "function") return null;
  const doc = card.ownerDocument;
  const scroller = hooks.scroller || scrollParent(card);
  const stageTop = whole(scroller?.scrollTop || 0);
  const pageTop = readViewportTop(doc);
  card.setAttribute("tabindex", "-1");
  const hold = doc?.getElementById?.("profile-stage");
  hold?.classList.add("is-holding-scroll");
  try {
    card.focus({ preventScroll: true });
  } catch {
    card.focus?.();
  }
  update(card);
  const apply = () => {
    if (scroller) scroller.scrollTop = stageTop;
    writeViewportTop(doc, pageTop);
    try {
      card.focus({ preventScroll: true });
    } catch {
      card.focus?.();
    }
  };
  apply();
  const frame = hooks.frame || (typeof doc?.defaultView?.requestAnimationFrame === "function" ? (fn) => doc.defaultView.requestAnimationFrame(fn) : null);
  const later = hooks.later || (typeof doc?.defaultView?.setTimeout === "function" ? (fn) => doc.defaultView.setTimeout(fn, 0) : null);
  if (typeof frame === "function") frame(() => {
    apply();
    frame(apply);
  });
  if (typeof later === "function") later(apply);
  return { card, stageTop, pageTop };
}
