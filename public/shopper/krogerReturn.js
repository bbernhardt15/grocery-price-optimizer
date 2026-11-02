/** Shopper return from the Kroger OAuth page. The cart itself stays on kroger.com. */
export const KROGER_CONNECTED_KEY = "gg-kroger-connected";
export const KROGER_CART_URL = "https://www.kroger.com/cart";

const KINDS = new Set(["added", "error", "connected"]);

/** @param {unknown} value */
export function cleanKrogerMessage(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/**
 * Read `/?kroger=connected|added|error` from a search string or a full URL.
 * Connect lands on Plan. A cart write lands on Shop.
 * @param {string | null | undefined} search
 * @returns {{ kind: "added" | "error" | "connected", message: string, step: "plan" | "shop" | null } | null}
 */
export function parseKrogerReturn(search) {
  const raw = String(search || "");
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1).split("#")[0] : raw.replace(/^\?/, "");
  if (!query) return null;
  const params = new URLSearchParams(query);
  const kind = params.get("kroger");
  if (!kind || !KINDS.has(kind)) return null;
  const requested = params.get("step");
  /** @type {"plan" | "shop" | null} */
  let step = null;
  if (kind === "added") step = "shop";
  else if (kind === "connected") step = requested === "shop" ? "shop" : "plan";
  else if (requested === "plan" || requested === "shop") step = requested;
  const fallback =
    kind === "connected"
      ? "Kroger connected."
      : kind === "added"
        ? "Kroger accepted the cart."
        : "Kroger did not add those items.";
  return {
    kind: /** @type {"added" | "error" | "connected"} */ (kind),
    message: cleanKrogerMessage(params.get("message")) || fallback,
    step,
  };
}

/**
 * The in-app browser should close once Kroger has sent the shopper back.
 * The callback URL itself stays open long enough for that redirect.
 * @param {string | null | undefined} url
 */
export function krogerBrowserShouldClose(url) {
  return parseKrogerReturn(url) != null;
}

/**
 * A callback that includes a login code, and no error, means Kroger accepted sign-in.
 * Used when the phone closes the browser before the redirect query is visible.
 * @param {string | null | undefined} url
 */
export function krogerCallbackSucceeded(url) {
  const value = String(url || "");
  if (!/\/api\/kroger\/oauth\/callback/.test(value)) return false;
  if (/[?&]error=/.test(value)) return false;
  return /[?&]code=/.test(value);
}

/** @param {string | null | undefined} kind */
export function krogerReturnMarksConnected(kind) {
  return kind === "connected" || kind === "added";
}

export const KROGER_TRIP_KEY = "gg-kroger-trip";
export const KROGER_LEAVE_NOTE = "Kroger will ask you to sign in once, then bring you right back.";

/**
 * iOS standalone PWAs lose the page when login.kroger.com replaces the tab.
 * A popup keeps this page. Same-tab redirect is the fallback when the popup is blocked.
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number, standalone?: boolean, displayMode?: string }} [env]
 */
export function krogerLoginMode(env = {}) {
  const ua = String(env.userAgent || "");
  const ios = /iPad|iPhone|iPod/.test(ua) || (env.platform === "MacIntel" && Number(env.maxTouchPoints) > 1);
  const standalone = env.standalone === true || env.displayMode === "standalone";
  return ios && standalone ? "popup" : "same-tab";
}

/**
 * @param {string | null | undefined} message
 * @param {number | null | undefined} [fallbackCount]
 */
export function krogerAddedConfirmation(message, fallbackCount) {
  const text = String(message || "");
  const ofMatch = text.match(/\b(\d+)\s+of\s+(\d+)\b/);
  const added = text.match(/\badded\s+(\d+)\b/i);
  const parsed = ofMatch ? Number(ofMatch[1]) : added ? Number(added[1]) : Number(fallbackCount);
  if (!Number.isFinite(parsed) || parsed < 0) return "Added items to your Kroger cart";
  const count = Math.floor(parsed);
  return count === 1 ? "Added 1 item to your Kroger cart" : `Added ${count} items to your Kroger cart`;
}

/**
 * Full trip handoff saved before the browser leaves for Kroger.
 * @param {{ setItem: (key: string, value: string) => void } | null | undefined} storage
 * @param {{ scroll?: number, itemCount?: number, plan?: object, edits?: object, checks?: object, itemChecks?: object }} [state]
 */
export function saveKrogerTrip(storage, state = {}) {
  if (!storage) return false;
  const payload = {
    step: "shop",
    scroll: Math.max(0, Math.floor(Number(state.scroll) || 0)),
    itemCount: Math.max(0, Math.floor(Number(state.itemCount) || 0)),
    pendingSend: true,
    plan: state.plan || null,
    edits: state.edits || null,
    checks: state.checks || null,
    itemChecks: state.itemChecks || null,
    savedAt: Date.now(),
  };
  try {
    storage.setItem(KROGER_TRIP_KEY, JSON.stringify(payload));
    return true;
  } catch {
    try {
      storage.setItem(KROGER_TRIP_KEY, JSON.stringify({ ...payload, plan: null }));
      return true;
    } catch {
      return false;
    }
  }
}

/** @param {{ getItem: (key: string) => string | null } | null | undefined} storage */
export function readKrogerTrip(storage) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(KROGER_TRIP_KEY) || "null");
    if (!parsed || parsed.pendingSend !== true || parsed.step !== "shop") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** @param {{ removeItem: (key: string) => void } | null | undefined} storage */
export function clearKrogerTrip(storage) {
  if (!storage) return;
  storage.removeItem(KROGER_TRIP_KEY);
}
