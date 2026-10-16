/**
 * Pure helpers for shared lists. The page passes `apiUrl` from the Capacitor
 * shell (`window.apiUrl`) so links and API calls are not stuck on capacitor://.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export function listTokenFromPath(pathname) {
  const match = /^\/list\/([A-Za-z0-9_-]{43,128})\/?$/.exec(String(pathname || ""));
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

function globalApiUrl() {
  const value = globalThis.apiUrl;
  if (typeof value === "string" || typeof value === "function") {
    return value;
  }
  return undefined;
}

function configuredBase(configured) {
  if (typeof configured === "function") {
    return configured;
  }
  if (typeof configured !== "string") {
    return undefined;
  }
  const trimmed = configured.trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/**
 * Resolve a site path. A string `apiUrl` is the hosted origin. A function
 * `apiUrl` receives the path and returns the URL the shell should call.
 * With no apiUrl, same-origin relative paths are unchanged.
 */
export function apiUrl(path, env = {}) {
  const configured = Object.prototype.hasOwnProperty.call(env, "apiUrl") ? env.apiUrl : globalApiUrl();
  const base = configuredBase(configured);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (typeof base === "function") {
    return base(suffix);
  }
  if (typeof base === "string") {
    return `${base}${suffix}`;
  }
  return suffix;
}

/** Absolute link a friend can open. Uses apiUrl before the WebView origin. */
export function sharePageUrl(token, env = {}) {
  const path = `/list/${encodeURIComponent(token)}`;
  const resolved = apiUrl(path, env);
  if (/^[a-z][a-z0-9+.-]*:/i.test(resolved)) {
    return resolved;
  }
  const href = env.locationHref || (typeof location !== "undefined" ? location.href : "http://localhost/");
  return new URL(resolved, href).href;
}

export function shareTransport(env = {}) {
  const plugin = env.capacitorShare ?? env.Capacitor?.Plugins?.Share;
  if (plugin && typeof plugin.share === "function") {
    return "capacitor";
  }
  const webShare = env.navigatorShare ?? env.navigator?.share;
  if (typeof webShare === "function") {
    return "web-share";
  }
  return "copy";
}

export async function deliverShare(details, env = {}) {
  const transport = shareTransport(env);
  if (transport === "capacitor") {
    const plugin = env.capacitorShare ?? env.Capacitor.Plugins.Share;
    await plugin.share({
      title: details.title,
      text: details.text,
      url: details.url,
      dialogTitle: details.dialogTitle || "Share list",
    });
    return "capacitor";
  }
  if (transport === "web-share") {
    const webShare = env.navigatorShare ?? env.navigator.share.bind(env.navigator);
    await webShare({ title: details.title, text: details.text, url: details.url });
    return "web-share";
  }
  if (typeof env.copy !== "function") {
    throw new Error("This device cannot share or copy the link.");
  }
  await env.copy(details.url);
  return "copy";
}

export function isShareCancel(error) {
  return Boolean(error && (error.name === "AbortError" || error.message === "Share canceled"));
}

export function attributionLine(item) {
  const parts = [];
  if (item?.addedBy) parts.push(`Added by ${item.addedBy}`);
  if (item?.checked && item?.checkedBy) parts.push(`Checked off by ${item.checkedBy}`);
  return parts.join(" · ");
}

/**
 * Remote rows are the base. Pending local rows replace a remote row only when
 * their writtenAt is newer (last write wins for that item).
 */
export function mergeSnapshot(localItems, remoteItems, pendingIds) {
  const pending = pendingIds instanceof Set ? pendingIds : new Set(pendingIds || []);
  const merged = new Map();
  for (const item of remoteItems || []) {
    if (item?.itemId) merged.set(item.itemId, item);
  }
  for (const item of localItems || []) {
    if (!item?.itemId || !pending.has(item.itemId)) continue;
    const other = merged.get(item.itemId);
    if (!other || Number(item.writtenAt) > Number(other.writtenAt)) {
      merged.set(item.itemId, item);
    }
  }
  return [...merged.values()];
}

export function visibleItems(items) {
  return (items || []).filter((item) => item && !item.deleted);
}
