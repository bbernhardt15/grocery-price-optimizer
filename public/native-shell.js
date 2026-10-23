/**
 * Shared by the website and the Capacitor shells.
 * The website keeps same-origin /api requests. The native WebView, which loads
 * the synced files from public/, calls the Railway HTTPS API instead.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.GroceryGitterNative = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT_NATIVE_API = "https://grocery-price-optimizer-production.up.railway.app";

  function bundledWebView(location) {
    const protocol = location?.protocol || "";
    const hostname = location?.hostname || "";
    if (protocol === "capacitor:" || protocol === "ionic:" || protocol === "file:") return true;
    // Android loads synced assets from https://localhost (server.androidScheme).
    // A live-reload URL uses http, or an https host that is not localhost.
    return protocol === "https:" && hostname === "localhost";
  }

  function httpsOrigin(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" || url.username || url.password) return "";
      return url.origin;
    } catch {
      return "";
    }
  }

  /**
   * Origin to prefix onto /api requests.
   * Empty string means "same origin as the page" (website, installed PWA, or
   * a Capacitor live reload pointed at CAPACITOR_SERVER_URL).
   */
  function resolveApiOrigin(input) {
    const native = Boolean(input?.native);
    if (!native) return "";
    if (!bundledWebView(input.location)) return "";
    return httpsOrigin(input.configured) || DEFAULT_NATIVE_API;
  }

  /**
   * CAPACITOR_API_URL for `npm run cap:sync`. Blank uses the production origin.
   * Throws when the value is set but is not an https origin.
   */
  function resolveSyncApiUrl(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return DEFAULT_NATIVE_API;
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error("CAPACITOR_API_URL is not a valid URL");
    }
    if (url.protocol !== "https:") {
      throw new Error("CAPACITOR_API_URL must use https");
    }
    if (url.username || url.password) {
      throw new Error("CAPACITOR_API_URL must not include credentials");
    }
    if (url.search || url.hash || (url.pathname && url.pathname !== "/")) {
      throw new Error("CAPACITOR_API_URL must be an origin, without a path, query, or hash");
    }
    return url.origin;
  }

  function resolveMediaUrl(url, apiOrigin) {
    const value = String(url || "");
    if (!value || !apiOrigin) return value;
    if (value.startsWith("/api/") || value.startsWith("/api?")) return `${apiOrigin}${value}`;
    return value;
  }

  function isExternalHttp(url) {
    return /^https?:\/\//i.test(String(url || ""));
  }

  /**
   * The native WebView treats extensionless paths as the shopper app.
   * /privacy and /terms are real pages on the website; the bundled copies
   * are privacy.html and terms.html.
   */
  function bundledLegalPath(pathname) {
    const path = String(pathname || "");
    if (path === "/privacy" || path === "/privacy/") return "/privacy.html";
    if (path === "/terms" || path === "/terms/") return "/terms.html";
    return "";
  }

  /**
   * True for retailer https links. Same-document hashes and the bundled
   * WebView origin (https://localhost or capacitor://localhost) stay in the app.
   */
  function isExternalNavigation(href, pageHref) {
    let page;
    let url;
    try {
      page = new URL(pageHref);
      url = new URL(href, pageHref);
    } catch {
      return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.origin !== page.origin;
  }

  return {
    DEFAULT_NATIVE_API,
    resolveApiOrigin,
    resolveSyncApiUrl,
    resolveMediaUrl,
    isExternalHttp,
    isExternalNavigation,
    bundledLegalPath,
  };
});
