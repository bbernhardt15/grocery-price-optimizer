/**
 * Price-drop opt-in for one saved list.
 * The list switch watches every line. A line can watch itself when the list
 * is off, or skip itself when the list is on.
 */

export function itemWatched(listEnabled, watch) {
  if (watch === "on") return true;
  if (watch === "off") return false;
  return Boolean(listEnabled);
}

/** Checkbox state the shopper just chose, stored as inherit / on / off. */
export function nextItemWatch(listEnabled, want) {
  if (listEnabled) return want ? "inherit" : "off";
  return want ? "on" : "inherit";
}

/** Blank clears the target. Anything that is not a positive dollar amount is ignored. */
export function parseTargetPrice(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 100000) return null;
  return Math.round(value * 100) / 100;
}
