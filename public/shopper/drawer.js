/**
 * Phone menu drawer. The header keeps the logo and search.
 * ZIP, alerts, theme, settings, and help live in the drawer.
 */

/**
 * @param {string[]} ids
 * @param {string | null | undefined} active
 * @param {boolean} shift
 * @returns {string | null}
 */
export function nextTrapTarget(ids, active, shift) {
  const list = (ids || []).filter((id) => typeof id === "string" && id.length > 0);
  if (list.length === 0) return null;
  const index = list.indexOf(String(active ?? ""));
  if (index < 0) return shift ? list[list.length - 1] : list[0];
  if (shift && index === 0) return list[list.length - 1];
  if (!shift && index === list.length - 1) return list[0];
  return null;
}

/**
 * A leftward swipe closes the drawer. Small drifts do not.
 * @param {number} startX
 * @param {number} endX
 */
export function swipeClosesDrawer(startX, endX) {
  const start = Number(startX);
  const end = Number(endX);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return end - start <= -48;
}
