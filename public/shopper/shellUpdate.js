/**
 * Home-screen web app updates.
 *
 * iOS keeps a standalone Grocery Gitter process warm. Opening the icon
 * often resumes the old page instead of loading a new one, and WebKit
 * will satisfy a service-worker fetch from the HTTP cache unless the
 * worker asks for `no-store`. A new deploy should apply the next time
 * the icon is opened, not in the middle of a tap.
 */

/**
 * Safari's "Add to Home Screen" sets navigator.standalone. Newer iOS
 * also matches display-mode: standalone from the web manifest.
 * @param {{ standalone?: boolean } | null | undefined} nav
 * @param {(query: string) => { matches?: boolean }} [matchMedia]
 */
export function isHomeScreenApp(nav, matchMedia) {
  if (nav && nav.standalone === true) return true;
  if (typeof matchMedia !== "function") return false;
  try {
    return Boolean(matchMedia("(display-mode: standalone)")?.matches);
  } catch {
    return false;
  }
}

/**
 * Reload once when a new shell is ready and the shopper is coming back
 * to the app. A page they are looking at stays put.
 * @param {{ pending?: boolean, hidden?: boolean, homeScreen?: boolean, alreadyReloaded?: boolean, sawHidden?: boolean }} state
 */
export function shouldApplyShellUpdate(state = {}) {
  if (!state.pending || state.alreadyReloaded || state.hidden) return false;
  // The icon was backgrounded, or this is the standalone app being shown
  // again. iOS will not navigate on its own.
  if (state.sawHidden) return true;
  return Boolean(state.homeScreen && state.pending);
}
