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

/** Clear a document scroll lock left by a modal. Does not hide overflow. */
export function releaseDocumentScroll(doc) {
  const body = doc?.body;
  const root = doc?.documentElement;
  if (body?.style) {
    body.style.overflow = "";
    body.style.position = "";
    body.style.top = "";
    body.style.width = "";
  }
  if (root?.style) {
    root.style.overflow = "";
    root.style.position = "";
  }
  return true;
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
