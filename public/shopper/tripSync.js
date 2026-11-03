/**
 * The trip is shared by every Grocery Gitter tab on this origin.
 * A handoff tab tells the opener, then closes when the browser allows it.
 */

export const TRIP_CHANNEL = "gg-trip";
export const TRIP_DB = "grocery-gitter";
export const TRIP_STORE = "trip";

/**
 * An empty in-memory list must not erase a trip that is already stored.
 * @param {number} storedCount
 * @param {number} nextCount
 * @param {boolean} explicitClear
 */
export function emptyMustNotReplace(storedCount, nextCount, explicitClear) {
  return !explicitClear && storedCount > 0 && nextCount === 0;
}

/**
 * @param {{ savedAt?: number } | null | undefined} local
 * @param {{ savedAt?: number } | null | undefined} incoming
 */
export function newerRecord(local, incoming) {
  if (!incoming || typeof incoming !== "object") return local || null;
  if (!local || typeof local !== "object") return incoming;
  const left = Number(local.savedAt) || 0;
  const right = Number(incoming.savedAt) || 0;
  return right >= left ? incoming : local;
}

/**
 * @param {object[] | null | undefined} items
 * @param {object | null | undefined} plan
 * @param {string} step
 * @param {object | null | undefined} handoff
 * @param {number} [savedAt]
 */
export function tripRecord(items, plan, step, handoff, savedAt = Date.now()) {
  return {
    items: Array.isArray(items) ? items : [],
    plan: plan || null,
    step: step === "plan" || step === "shop" ? step : "add",
    handoff: handoff || null,
    savedAt,
  };
}

/**
 * @param {{ type?: string, store?: string, kind?: string } | null | undefined} message
 */
export function handoffResultMessage(message) {
  if (!message || message.type !== "gg-handoff") return null;
  const store = String(message.store || "").trim();
  if (!store) return null;
  const kind = message.kind === "coupons" ? "coupons" : message.kind === "cart" ? "cart" : "store";
  return { type: "gg-handoff", store, kind, at: Number(message.at) || Date.now() };
}

/** A tab opened by the app can close. A typed address cannot. */
export function callbackCanClose(opener) {
  return Boolean(opener);
}

export function returnScreenCopy(store, kind) {
  const name = String(store || "the store").trim() || "the store";
  if (kind === "coupons") {
    return {
      title: "Return to Grocery Gitter",
      body: `Coupon clipping stays on ${name}. Switch back to your Grocery Gitter tab when you are done.`,
    };
  }
  return {
    title: "Return to Grocery Gitter",
    body: `Your ${name} trip is in the other Grocery Gitter tab.`,
  };
}

/**
 * @param {IDBFactory | null | undefined} factory
 * @param {object} record
 */
export function writeTripDb(factory, record) {
  if (!factory?.open || !record) return Promise.resolve(false);
  return new Promise((resolve) => {
    let request;
    try {
      request = factory.open(TRIP_DB, 1);
    } catch {
      resolve(false);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRIP_STORE)) db.createObjectStore(TRIP_STORE);
    };
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction(TRIP_STORE, "readwrite");
        tx.objectStore(TRIP_STORE).put(record, "active");
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          resolve(false);
        };
      } catch {
        db.close();
        resolve(false);
      }
    };
  });
}

/**
 * @param {IDBFactory | null | undefined} factory
 */
export function readTripDb(factory) {
  if (!factory?.open) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request;
    try {
      request = factory.open(TRIP_DB, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRIP_STORE)) db.createObjectStore(TRIP_STORE);
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction(TRIP_STORE, "readonly");
        const get = tx.objectStore(TRIP_STORE).get("active");
        get.onsuccess = () => {
          db.close();
          resolve(get.result || null);
        };
        get.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
}
