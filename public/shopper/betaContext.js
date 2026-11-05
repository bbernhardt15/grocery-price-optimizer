/** Non-sensitive context for beta feedback. Item names and receipt text stay out. */

export const SHELL_CACHE = "v47";
export const APP_VERSION = "1.0.0";
export const INVITE_KEY = "gg-beta-code";

export const PRODUCT_EVENTS = [
  "onboarding_completed",
  "receipt_imported",
  "plan_built",
  "kroger_cart_sent",
  "walmart_opened",
  "trip_completed",
  "feedback_sent",
];

export function clip(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
    .slice(0, max);
}

export function countList(storage) {
  if (!storage) return 0;
  try {
    const parsed = JSON.parse(storage.getItem("gg-list") || "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function countStores(storage) {
  if (!storage) return 0;
  try {
    const parsed = JSON.parse(storage.getItem("gg-last-trip") || "null");
    const stores = parsed?.payload?.stores;
    return Array.isArray(stores) ? stores.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Counts only. The list and the saved trip are not copied into the payload.
 */
export function feedbackContext({ storage, userAgent, pathname, tab, now } = {}) {
  const when = now instanceof Date ? now : new Date(now || Date.now());
  return {
    appVersion: APP_VERSION,
    shellCache: SHELL_CACHE,
    screen: clip(pathname || "/", 80),
    tab: clip(tab || "", 40),
    userAgent: clip(userAgent || "", 300),
    tripItemCount: countList(storage),
    storeCount: countStores(storage),
    timestamp: when.toISOString(),
  };
}

export function feedbackBody({ rating, message, screen, context, deviceId }) {
  return {
    rating,
    message: clip(message, 2000),
    screen: clip(screen, 80),
    context,
    deviceId,
  };
}

export function readInvite(storage) {
  if (!storage) return "";
  try {
    return clip(storage.getItem(INVITE_KEY) || "", 80);
  } catch {
    return "";
  }
}

export function rememberInvite(storage, code) {
  if (!storage) return;
  storage.setItem(INVITE_KEY, clip(code, 80));
}

export function clearInvite(storage) {
  if (!storage) return;
  try {
    storage.removeItem(INVITE_KEY);
  } catch {
    /* private browsing */
  }
}
