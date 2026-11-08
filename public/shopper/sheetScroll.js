/**
 * Handoff sheets scroll inside the sheet. The document keeps its own
 * scroll so iOS rubber-banding is not cancelled by overflow:hidden.
 */

/**
 * @param {HTMLDialogElement | { open?: boolean, show?: () => void, setAttribute?: (name: string, value: string) => void, classList?: { add: (name: string) => void } } | null | undefined} dialog
 * @param {{ readScroll?: () => number, writeScroll?: (y: number) => void, releaseScroll?: () => void }} [io]
 */
export function openHandoffSheet(dialog, io = {}) {
  if (!dialog) return false;
  dialog.classList?.add("handoff-sheet");
  const read = typeof io.readScroll === "function" ? io.readScroll : () => 0;
  const write = typeof io.writeScroll === "function" ? io.writeScroll : () => {};
  const before = Number(read()) || 0;
  if (!dialog.open) {
    if (typeof dialog.show === "function") dialog.show();
    else dialog.setAttribute?.("open", "");
  }
  const after = Number(read()) || 0;
  if (Math.abs(after - before) > 1) write(before);
  if (typeof io.releaseScroll === "function") io.releaseScroll();
  return true;
}

const LOCK_PROPS = ["overflow", "overflowY", "overflowX", "position", "top", "left", "right", "width", "height", "touchAction"];

function clearLockStyles(node) {
  if (!node?.style) return;
  for (const prop of LOCK_PROPS) node.style[prop] = "";
  if ("pointerEvents" in node.style) node.style.pointerEvents = "";
}

function scrollLocked(body, root) {
  if (!body?.style) return false;
  if (body.style.position === "fixed") return true;
  if (body.style.overflow === "hidden" || body.style.overflowY === "hidden") return true;
  if (root?.style?.overflow === "hidden" || root?.style?.overflowY === "hidden") return true;
  if (body.classList?.contains?.("modal-open") || body.classList?.contains?.("scroll-lock")) return true;
  if (root?.classList?.contains?.("modal-open") || root?.classList?.contains?.("scroll-lock")) return true;
  if (body.inert) return true;
  return false;
}

/**
 * Clear a document scroll lock left by a modal sheet.
 * A fixed body with a negative top is the scroll offset to restore.
 * @param {Document | { body?: any, documentElement?: any, defaultView?: any, scrollingElement?: any, querySelector?: (selector: string) => any } | null | undefined} doc
 */
export function releaseScrollLock(doc) {
  const body = doc?.body;
  const root = doc?.documentElement;
  if (!body?.style || !root?.style) return { released: false, y: 0 };
  if (!scrollLocked(body, root)) return { released: false, y: 0, reason: "unlocked" };
  let y = 0;
  if (body.style.position === "fixed") {
    const top = parseInt(body.style.top || "0", 10);
    if (Number.isFinite(top)) y = Math.abs(top);
  } else if (doc.defaultView && Number.isFinite(doc.defaultView.scrollY)) {
    y = Math.max(0, doc.defaultView.scrollY);
  } else if (Number.isFinite(root.scrollTop)) {
    y = Math.max(0, root.scrollTop);
  }
  clearLockStyles(body);
  clearLockStyles(root);
  body.classList?.remove?.("modal-open", "scroll-lock");
  root.classList?.remove?.("modal-open", "scroll-lock");
  if ("inert" in body) body.inert = false;
  doc.querySelector?.(".shell")?.removeAttribute?.("inert");
  const view = doc.defaultView;
  if (view && typeof view.scrollTo === "function") view.scrollTo(0, y);
  const scroller = doc.scrollingElement || root;
  if (scroller && typeof scroller.scrollTop === "number") {
    const next = Math.max(0, y);
    scroller.scrollTop = next + 1;
    scroller.scrollTop = next;
  }
  return { released: true, y };
}

/** Clear a document scroll lock left by a modal. Does not hide overflow. */
export function releaseDocumentScroll(doc) {
  releaseScrollLock(doc);
  return true;
}

/**
 * Sheets scroll inside themselves. Releasing while one is still open
 * would fight the next sheet. Pull-to-refresh stays off while a sheet is up.
 * @param {Document | { querySelector?: (selector: string) => unknown } | null | undefined} doc
 */
export function releaseAfterLastSheet(doc) {
  if (doc?.querySelector?.("dialog[open]")) return { released: false, y: 0, reason: "open" };
  const result = releaseScrollLock(doc);
  return { ...result, reason: result.reason || (result.released ? "released" : "missing") };
}

/**
 * @param {{ sheetOpen?: boolean, scrollY?: number }} [input]
 */
export function pullAllowed(input = {}) {
  if (input.sheetOpen) return false;
  return !((Number(input.scrollY) || 0) > 8);
}

/**
 * A saved offset is applied only when nothing is touching the screen and
 * no handoff sheet is open. Otherwise the write fights rubber-banding.
 * @param {number} saved
 * @param {number} current
 * @param {{ touching?: boolean, sheetOpen?: boolean }} [flags]
 * @returns {number | null}
 */
export function scrollRestoreOffset(saved, current, flags = {}) {
  if (flags.touching || flags.sheetOpen) return null;
  const y = Math.max(0, Math.floor(Number(saved) || 0));
  const now = Math.max(0, Math.floor(Number(current) || 0));
  if (y === now) return null;
  return y;
}
