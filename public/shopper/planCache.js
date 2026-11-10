/**
 * Review prices were a new live pass every visit. The 9-second budget
 * drops unfinished store calls, and that partial set was replacing the
 * last full total. A complete result for this list and ZIP is reused
 * until the list changes, 24 hours pass, or the shopper taps Refresh.
 */

export const PLAN_CACHE_KEY = "gg-plan-price-cache";
export const PLAN_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function zipOf(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 5);
  return /^\d{5}$/.test(digits) ? digits : "";
}

function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

/** @param {object | null | undefined} payload */
export function planIsComplete(payload) {
  if (!payload || payload.partial) return false;
  if (Array.isArray(payload.pendingStores) && payload.pendingStores.length > 0) return false;
  const checks = Array.isArray(payload.pricingByStore) ? payload.pricingByStore : [];
  if (checks.some((row) => row?.check && row.check !== "ok")) return false;
  return planIsShowable(payload);
}

/**
 * A finished plan the shopper can read. A store that timed out does not
 * hide prices that already came back.
 * @param {object | null | undefined} payload
 */
export function planIsShowable(payload) {
  if (!payload || typeof payload !== "object") return false;
  const items = (payload.stores || []).flatMap((store) => store?.items || []);
  return items.some((item) => Number(item?.price) > 0);
}

/** Items the shopper can read after a check ends, even when every price is still missing. */
export function planHasDisplay(payload) {
  if (!payload?.displaySettled) return false;
  return (payload.stores || []).some((store) => (store?.items || []).length > 0);
}

function planCanKeep(payload) {
  return planIsComplete(payload) || planIsShowable(payload) || planHasDisplay(payload);
}

/**
 * @param {{ getItem?: (key: string) => string | null } | null | undefined} storage
 */
export function readPlanCache(storage) {
  if (!storage?.getItem) return null;
  try {
    const parsed = JSON.parse(storage.getItem(PLAN_CACHE_KEY) || "null");
    if (!parsed?.payload?.stores || !parsed.signature) return null;
    return {
      signature: String(parsed.signature),
      zip: zipOf(parsed.zip),
      savedAt: Number(parsed.savedAt) || 0,
      payload: parsed.payload,
    };
  } catch {
    return null;
  }
}

/**
 * @param {{ setItem?: (key: string, value: string) => void } | null | undefined} storage
 */
export function writePlanCache(storage, entry) {
  if (!storage?.setItem || !entry?.payload || !planCanKeep(entry.payload)) return false;
  const savedAt = Number(entry.savedAt) || Date.now();
  storage.setItem(
    PLAN_CACHE_KEY,
    JSON.stringify({
      signature: String(entry.signature || ""),
      zip: zipOf(entry.zip),
      savedAt,
      payload: {
        ...entry.payload,
        pricedAt: entry.payload.pricedAt || savedAt,
        partial: false,
        pendingStores: [],
        displaySettled: true,
      },
    })
  );
  return true;
}

/** @param {{ removeItem?: (key: string) => void } | null | undefined} storage */
export function clearPlanCache(storage) {
  storage?.removeItem?.(PLAN_CACHE_KEY);
}

/**
 * @param {{ cache?: object | null, signature?: string, zip?: string, now?: number, force?: boolean, maxAgeMs?: number }} input
 */
export function shouldReusePlan(input = {}) {
  if (input.force) return false;
  const cache = input.cache;
  if (!cache?.payload || !planCanKeep(cache.payload)) return false;
  if (String(cache.signature || "") !== String(input.signature || "")) return false;
  if (zipOf(cache.zip) !== zipOf(input.zip)) return false;
  const at = Number(cache.savedAt) || 0;
  if (!at) return false;
  const maxAge = Number(input.maxAgeMs) > 0 ? Number(input.maxAgeMs) : PLAN_CACHE_MAX_AGE_MS;
  const now = Number(input.now) || Date.now();
  return now >= at && now - at <= maxAge;
}

/**
 * A partial pass or a store that timed out does not replace prices we already have.
 * @param {object | null | undefined} previous
 * @param {object | null | undefined} incoming
 * @param {number} [now]
 */
export function adoptReviewResult(previous, incoming, now = Date.now()) {
  if (!incoming?.stores?.length) {
    if (previous?.stores?.length) return { ...previous, keptPreviousPrices: true };
    return incoming || previous || null;
  }
  const prevComplete = planIsComplete(previous);
  const nextComplete = planIsComplete(incoming);
  if (prevComplete && !nextComplete) {
    return {
      ...previous,
      keptPreviousPrices: true,
    };
  }
  if (!nextComplete && planIsShowable(previous) && previous?.stores?.length) {
    const prevCount = (previous.stores || []).reduce((sum, store) => sum + (store.items || []).length, 0);
    const nextCount = (incoming.stores || []).reduce((sum, store) => sum + (store.items || []).length, 0);
    if (nextCount < prevCount) return { ...previous, keptPreviousPrices: true };
  }
  const pricedAt = nextComplete ? Number(incoming.pricedAt) || now : incoming.pricedAt;
  return { ...incoming, ...(pricedAt ? { pricedAt } : {}) };
}

/** @param {number} savedAt @param {number} [now] */
export function pricesUpdatedLabel(savedAt, now = Date.now()) {
  const at = Number(savedAt) || 0;
  if (!at) return "";
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 1) return "Prices updated just now";
  if (minutes === 1) return "Prices updated 1 minute ago";
  return `Prices updated ${minutes} minutes ago`;
}

/**
 * Items still called unfound only when a store actually answered.
 * A timed-out store is not a miss.
 * @param {string[] | null | undefined} names
 * @param {Array<{ check?: string }> | null | undefined} reports
 */
export function genuineUnfound(names, reports) {
  const list = (names || []).map((name) => String(name || "").trim()).filter(Boolean);
  const rows = reports || [];
  if (!rows.length) return list;
  const failed = rows.filter((row) => row?.check && row.check !== "ok");
  const ok = rows.filter((row) => !row?.check || row.check === "ok");
  if (failed.length && ok.length === 0) return [];
  return list;
}

export function couldntCheckNote(storeName, kind) {
  const name = String(storeName || "This store").trim() || "This store";
  if (kind === "rate_limit") return `${name} asked us to slow down. Retry in a moment.`;
  if (kind === "timeout") return `${name} is taking longer than usual. The other prices stay. Retry checks what's still waiting.`;
  return `${name} couldn't check right now, retry`;
}

/**
 * @param {{ coverageNotes?: Array<{ storeName?: string, text?: string }> } | null | undefined} plans
 * @param {Array<{ storeName?: string, check?: string }> | null | undefined} reports
 */
export function coverageNotesFor(plans, reports) {
  const failed = new Set(
    (reports || [])
      .filter((row) => row?.check && row.check !== "ok")
      .map((row) => String(row.storeName || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const unchecked = [...failed].map((key) => {
    const row = (reports || []).find((entry) => String(entry?.storeName || "").trim().toLowerCase() === key);
    const storeName = row?.storeName || key;
    return { storeName, text: couldntCheckNote(storeName, row?.check) };
  });
  const missing = (plans?.coverageNotes || []).filter((note) => !failed.has(String(note?.storeName || "").trim().toLowerCase()));
  return { unchecked, missing };
}

/**
 * Three Review visits. The pricer runs only when the cached complete
 * result cannot be reused.
 * @param {{ signature: string, zip: string, now: number, force?: boolean, price: () => object }} 
 */
export function createReviewSession() {
  let cache = null;
  return {
    read: () => cache,
    visit({ signature, zip, now, force = false, price }) {
      if (shouldReusePlan({ cache, signature, zip, now, force })) {
        return { total: roundMoney(cache.payload.total), source: "cache", payload: cache.payload };
      }
      const incoming = price();
      const sameTrip = cache && cache.signature === String(signature) && zipOf(cache.zip) === zipOf(zip);
      const previous = sameTrip ? cache.payload : null;
      const payload = adoptReviewResult(previous, incoming, now);
      if (planIsComplete(payload)) {
        cache = { signature: String(signature), zip: zipOf(zip), savedAt: Number(payload.pricedAt) || now, payload };
      } else if (previous && planIsComplete(previous)) {
        cache = { ...cache, payload: previous };
      }
      const shown = cache && planIsComplete(cache.payload) && cache.signature === String(signature) ? cache.payload : payload;
      const source = shown === cache?.payload && shown !== incoming ? (force ? "kept" : "cache") : "fresh";
      return { total: roundMoney(shown?.total), source, payload: shown };
    },
  };
}
