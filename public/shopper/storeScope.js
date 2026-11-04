/**
 * Which store names the shopper can see. The weekly-ad list stays in the
 * picker data. It is hidden unless the server says GG_SHOW_AD_STORES is on.
 * Saved names for hidden stores are kept so the flag can turn them back on.
 */

export const LIVE_STORES = ["Kroger", "Walmart"];

let showAds = false;

export function setShowAdStores(on) {
  showAds = Boolean(on);
}

export function adStoresVisible() {
  return showAds;
}

function canonicalLive(name) {
  const key = String(name || "").trim().toLowerCase();
  return LIVE_STORES.find((store) => store.toLowerCase() === key) || "";
}

/** @param {string[] | null | undefined} names */
export function visibleStoreNames(names) {
  const list = (names || []).map((name) => String(name || "").trim()).filter(Boolean);
  if (showAds) return list;
  const kept = [];
  const seen = new Set();
  for (const name of list) {
    const live = canonicalLive(name);
    if (!live || seen.has(live)) continue;
    seen.add(live);
    kept.push(live);
  }
  return kept;
}

/**
 * Checked boxes plus stores the flag is hiding.
 * All visible boxes checked, and nothing saved yet, stays "every store".
 * @param {string[]} picked
 * @param {string[] | null | undefined} prior
 * @param {boolean} allVisibleChecked
 */
export function mergeSavedStores(picked, prior, allVisibleChecked) {
  const previous = (prior || []).map((name) => String(name || "").trim()).filter(Boolean);
  const hidden = previous.filter((name) => visibleStoreNames([name]).length === 0);
  const chosen = (picked || []).map((name) => String(name || "").trim()).filter(Boolean);
  if (allVisibleChecked && hidden.length === 0) return [];
  const seen = new Set();
  const next = [];
  for (const name of [...chosen, ...hidden]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(name);
  }
  return next;
}
