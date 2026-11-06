/**
 * Chrome on iPhone treats an edge swipe as history.back().
 * A full-screen sheet that never pushed a history entry has nothing
 * to pop, so the swipe leaves the page for a blank tab.
 * One history entry makes that swipe close the sheet instead.
 *
 * Limit: if Chrome handles the gesture before the page (no popstate),
 * the app cannot catch it. A second swipe, after this entry is gone,
 * can still leave. This is the most a page can do.
 */

export function armSheetHistory(dialog, win) {
  const view = win || (typeof window !== "undefined" ? window : null);
  if (!dialog || !view || dialog.dataset.sheetHistory === "1") {
    return { push() {} };
  }
  dialog.dataset.sheetHistory = "1";
  let pushed = false;
  let fromPop = false;
  const key = dialog.id || "sheet";
  view.addEventListener("popstate", () => {
    if (!dialog.open) {
      pushed = false;
      return;
    }
    fromPop = true;
    pushed = false;
    dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (fromPop) {
      fromPop = false;
      return;
    }
    if (!pushed) return;
    pushed = false;
    try {
      view.history.back();
    } catch {
      /* already at the first entry */
    }
  });
  return {
    push() {
      if (pushed) return;
      try {
        view.history.pushState({ ggSheet: key }, "");
        pushed = true;
      } catch {
        pushed = false;
      }
    },
  };
}
