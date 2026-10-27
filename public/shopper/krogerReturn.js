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
