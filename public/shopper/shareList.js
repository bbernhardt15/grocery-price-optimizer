/**
 * Pure helpers for shared lists. Share links use the hosted origin from
 * `apiUrl()` / `GroceryGitterNative.resolveApiOrigin` (`CAPACITOR_API_URL`
 * in the bundled app, empty on the website so the link stays on this site).
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export function listTokenFromPath(pathname) {
  const match = /^\/list\/([A-Za-z0-9_-]{43,128})\/?$/.exec(String(pathname || ""));
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

/**
 * Absolute link a friend can open.
 * `apiOrigin` is the string `apiUrl()` prefixes (https origin, or empty for
 * same-origin). A bundled WebView origin is never copied into the link.
 */
export function sharePageUrl(token, env = {}) {
  const path = `/list/${encodeURIComponent(token)}`;
  const origin = String(env.apiOrigin || "").trim().replace(/\/$/, "");
  if (/^https:\/\//i.test(origin)) {
    return `${origin}${path}`;
  }
  const href = env.locationHref || (typeof location !== "undefined" ? location.href : "http://localhost/");
  return new URL(path, href).href;
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
