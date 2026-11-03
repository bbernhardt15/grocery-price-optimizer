/**
 * Grocery Gitter on an iPhone is tested in Chrome (CriOS), a WebKit tab
 * with its own bottom toolbar. It is not Safari and not the home-screen app.
 * A new tab cannot rely on window.close() or opener postMessage.
 */

import { keyboardOverlap } from "./phone.js";

export const HANDOFF_RESULT_KEY = "gg-handoff-result";
export const HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;

/** Real Chrome-on-iPhone token. The UA still contains "Safari". */
export function isChromeIos(userAgent) {
  return /CriOS\//i.test(String(userAgent || ""));
}

/** Chrome on iOS has no add-to-home-screen prompt we can drive. */
export function pwaInstallApplies(userAgent) {
  return !isChromeIos(userAgent);
}

/**
 * WebKit on Chrome often returns a reduced-accuracy fix even when the page
 * asked for high accuracy. A precise meter reading is still a suggestion.
 * @param {string | null | undefined} userAgent
 * @param {number | null | undefined} accuracyMeters
 * @param {boolean} [forcedApproximate]
 */
export function chromeFixIsApproximate(userAgent, accuracyMeters, forcedApproximate = false) {
  if (forcedApproximate || isChromeIos(userAgent)) return true;
  if (accuracyMeters == null || accuracyMeters === "") return true;
  const meters = Number(accuracyMeters);
  if (!Number.isFinite(meters) || meters < 0) return true;
  return meters > 100;
}

export function locationDeniedCopy(userAgent) {
  if (isChromeIos(userAgent)) {
    return "Chrome on this iPhone kept location off. Type a ZIP instead.";
  }
  return "Location stayed off. Type a ZIP and try again.";
}

/**
 * @param {string | null | undefined} userAgent
 * @param {unknown} opener
 */
export function handoffTabPlan(userAgent, opener) {
  const chrome = isChromeIos(userAgent);
  return {
    showReturn: true,
    tryClose: !chrome && Boolean(opener),
    postToOpener: !chrome && Boolean(opener),
    relyOnStorage: true,
  };
}

/**
 * @param {string} store
 * @param {string} kind
 * @param {object | null} [detail]
 * @param {number} [at]
 */
export function handoffResultRecord(store, kind, detail = null, at = Date.now()) {
  const name = String(store || "").trim().slice(0, 40);
  const mode = kind === "coupons" ? "coupons" : kind === "cart" ? "cart" : "store";
  return {
    type: "gg-handoff",
    store: name || "the store",
    kind: mode,
    at: Number(at) || Date.now(),
    detail: detail && typeof detail === "object" ? detail : null,
  };
}

/**
 * @param {{ getItem: (key: string) => string | null } | null | undefined} storage
 * @param {number} [now]
 */
export function readHandoffResult(storage, now = Date.now()) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(HANDOFF_RESULT_KEY) || "null");
    if (!parsed || parsed.type !== "gg-handoff" || !parsed.store) return null;
    const at = Number(parsed.at) || 0;
    if (!at || now - at > HANDOFF_MAX_AGE_MS) return null;
    return handoffResultRecord(parsed.store, parsed.kind, parsed.detail, at);
  } catch {
    return null;
  }
}

/**
 * @param {{ setItem: (key: string, value: string) => void } | null | undefined} storage
 * @param {ReturnType<typeof handoffResultRecord>} record
 */
export function writeHandoffResult(storage, record) {
  if (!storage || !record?.store) return false;
  try {
    storage.setItem(HANDOFF_RESULT_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

const STORE_HOSTS = [
  "kroger.com",
  "walmart.com",
  "target.com",
  "aldi.us",
  "publix.com",
  "meijer.com",
  "heb.com",
  "safeway.com",
  "albertsons.com",
  "instacart.com",
];

function hostAllowed(hostname) {
  const host = String(hostname || "").toLowerCase();
  return STORE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Only store sites, or this app's Kroger authorize path. Blocks open redirects.
 * @param {string | null | undefined} value
 * @param {string | null | undefined} [ownOrigin]
 */
export function safeHandoffUrl(value, ownOrigin) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return "";
  }
  if (url.username || url.password) return "";
  const own = String(ownOrigin || "");
  if (own && url.origin === own) {
    return url.pathname.startsWith("/api/kroger/") ? url.toString() : "";
  }
  if (url.protocol !== "https:") return "";
  return hostAllowed(url.hostname) ? url.toString() : "";
}

/**
 * Chrome's bottom toolbar is not a safe-area inset. A short visualViewport
 * gap with no focused field is that toolbar. A focused field, or a tall gap,
 * is the keyboard.
 * @param {{ innerHeight?: number, visualHeight?: number, offsetTop?: number, focused?: boolean }} input
 */
export function viewportInsets(input = {}) {
  const overlap = keyboardOverlap(input.innerHeight, input.visualHeight, input.offsetTop);
  if (input.focused || overlap >= 140) return { keyboard: overlap, toolbar: 0 };
  return { keyboard: 0, toolbar: overlap };
}

/**
 * @param {string} store
 * @param {string} kind
 * @param {string} next
 */
export function handoffBridgePath(store, kind, next) {
  const params = new URLSearchParams();
  params.set("store", String(store || "Store").slice(0, 40));
  params.set("kind", kind === "coupons" ? "coupons" : kind === "cart" ? "cart" : "store");
  if (next) params.set("next", next);
  return `/handoff.html?${params.toString()}`;
}
