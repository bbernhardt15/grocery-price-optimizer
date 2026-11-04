/**
 * A tab changes from a shopper tap, or once when the page first loads.
 * Storage, another tab, a handoff callback, and a plan update do not
 * move the tab after that.
 */

export const TAB_CLICK_SHIELD_MS = 800;

export function createTabGuard() {
  return { interacted: false, restored: false, shieldUntil: 0 };
}

/** @param {ReturnType<typeof createTabGuard>} state */
export function noteTabInteraction(state) {
  return { ...(state || createTabGuard()), interacted: true };
}

/**
 * Ignore the click that iOS delivers to whatever sits under a closing sheet.
 * @param {ReturnType<typeof createTabGuard>} state
 */
export function armClickShield(state, now, ms = TAB_CLICK_SHIELD_MS) {
  return { ...(state || createTabGuard()), shieldUntil: (Number(now) || 0) + ms };
}

/** @param {ReturnType<typeof createTabGuard>} state */
export function clickShielded(state, now) {
  return Number(now) < Number(state?.shieldUntil || 0);
}

/** The one-time boot restore already happened, even if the tab stayed on Add. */
export function settleTabBoot(state) {
  return { ...(state || createTabGuard()), restored: true };
}

/**
 * @param {ReturnType<typeof createTabGuard>} state
 * @param {"user" | "boot" | "handoff" | "restore"} reason
 * user: a tap. boot: the one landing when the page first loads.
 * handoff: the Kroger or store return, once, and only before a tap.
 * restore: a later sync. It never moves the tab.
 */
export function allowTabChange(state, reason) {
  const current = state || createTabGuard();
  if (reason === "user") {
    return { state: noteTabInteraction(current), allow: true };
  }
  if (reason === "handoff") {
    if (current.interacted) return { state: current, allow: false };
    return { state: { ...current, restored: true }, allow: true };
  }
  if (current.interacted || current.restored) {
    return { state: current, allow: false };
  }
  if (reason === "boot") {
    return { state: { ...current, restored: true }, allow: true };
  }
  return { state: current, allow: false };
}
