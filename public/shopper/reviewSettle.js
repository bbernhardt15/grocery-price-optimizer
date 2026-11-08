/**
 * One total for a list.
 *
 * A Review visit used to paint every streamed snapshot. Those snapshots
 * were $265.89, then $265.53, then $286.09, and store notes ("couldn't
 * check", "missing 3 items") were inserted as each store answered.
 * PR #82 kept a complete result in localStorage, but the page still
 * called the pricer on every Review entry:
 * - showStep always ran planTrip after paintPlanNow, so a cached plan
 *   was drawn twice and the second draw merged leftover store lines
 * - a store timeout never passed planIsComplete, so nothing was cached
 *   and the next Build → Review → In-store → Review streamed again
 * - loadCachedTrip cleared plannedSignature, so the in-memory plan was
 *   not treated as the visit's result
 * Tab returns now paint the settled plan once and do not fetch.
 */

import { adoptReviewResult, planIsComplete, readPlanCache, shouldReusePlan, writePlanCache } from "./planCache.js";

export function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

/**
 * The same line math the trip editor uses: price times quantity.
 * A server subtotal is not a second source of truth.
 * @param {object | null | undefined} item
 */
export function lineAmount(item) {
  const quantity = Number(item?.quantity);
  const count = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  if (count <= 0) return 0;
  const price = Number(item?.price);
  if (Number.isFinite(price)) return roundMoney(price * count);
  const explicit = Number(item?.itemTotal);
  if (Number.isFinite(explicit)) return roundMoney(explicit);
  return 0;
}

/** @param {Array<{ items?: object[] }> | null | undefined} stores */
export function reconcileStores(stores) {
  return (stores || []).map((store) => {
    const items = (store?.items || []).map((item) => ({
      ...item,
      itemTotal: lineAmount(item),
    }));
    const subtotal = roundMoney(items.reduce((sum, item) => sum + (Number(item.itemTotal) || 0), 0));
    const itemCount = items.reduce((sum, item) => sum + (Number(item.quantity) > 0 ? Number(item.quantity) : 0), 0);
    return { ...store, items, subtotal, itemCount };
  });
}

/**
 * Cart card, store cards, and the plan headline share this figure.
 * @param {Array<{ items?: object[] }> | null | undefined} stores
 */
/** A store card says lines and units, so Milk x2 is not "1 item". */
export function storeLineLabel(lines, units) {
  const lineCount = Math.max(0, Math.floor(Number(lines) || 0));
  const unitCount = Math.max(lineCount, Math.floor(Number(units) || 0));
  const lineText = lineCount === 1 ? "1 line" : `${lineCount} lines`;
  if (!lineCount) return "0 lines";
  if (unitCount === lineCount) return lineText;
  return `${lineText} · ${unitCount} units`;
}

export function cartCardFigures(stores) {
  const reconciled = reconcileStores(stores);
  const total = roundMoney(reconciled.reduce((sum, store) => sum + store.subtotal, 0));
  const itemCount = reconciled.reduce((sum, store) => sum + store.itemCount, 0);
  return {
    stores: reconciled,
    total,
    itemCount,
    countLabel: storeLineLabel(reconciled.reduce((sum, store) => sum + (store.items || []).length, 0), itemCount),
  };
}

/**
 * Intermediate snapshots do not get a number. The first complete total
 * for a list stays until the shopper asks to refresh.
 */
export function createDisplayedTotal() {
  let signature = "";
  /** @type {number | null} */
  let total = null;
  return {
    shown() {
      return total;
    },
    /**
     * @param {string} signatureIn
     * @param {number} amount
     * @param {{ complete?: boolean, force?: boolean }} [options]
     */
    publish(signatureIn, amount, options = {}) {
      const sig = String(signatureIn || "");
      if (!options.complete) return signature === sig ? total : null;
      const next = roundMoney(amount);
      if (!options.force && signature === sig && total != null) return total;
      signature = sig;
      total = next;
      return total;
    },
  };
}

/**
 * Failure rows stay off the page while a check is still running and
 * while we are holding the last complete prices.
 * @param {object[] | null | undefined} notes
 * @param {{ settled?: boolean, kept?: boolean }} [options]
 */
export function coverageVisible(notes, options = {}) {
  if (!options.settled || options.kept) return [];
  return (notes || []).filter((note) => note && note.text);
}

/**
 * One quiet retry. It does not paint, and it does not run when the
 * shopper already has a settled total on screen.
 * @param {{ attempt?: number, hasSettled?: boolean, incomingComplete?: boolean }} [input]
 */
export function quietRetryPlan(input = {}) {
  const attempt = Math.max(0, Math.floor(Number(input.attempt) || 0));
  if (input.incomingComplete || input.hasSettled) return { retry: false, keep: Boolean(input.hasSettled), showErrors: false };
  if (attempt >= 1) return { retry: false, keep: false, showErrors: false };
  return { retry: true, keep: false, showErrors: false, delayMs: 1600 };
}

/**
 * @param {{ force?: boolean, cacheComplete?: boolean, memoryComplete?: boolean, sameList?: boolean, sameZip?: boolean }} [input]
 */
export function reviewEntryDecision(input = {}) {
  const sameList = input.sameList !== false;
  const sameZip = input.sameZip !== false;
  const cacheHit = Boolean(input.cacheComplete) && !input.force && sameList && sameZip;
  const memoryHit = Boolean(input.memoryComplete) && !input.force && sameList;
  const fetch = !(cacheHit || memoryHit);
  return {
    fetch,
    source: cacheHit || memoryHit ? "cache" : "network",
    partials: false,
    /**
     * The old page fetched whenever the stored payload was not complete,
     * and it also rebuilt the screen before that check. Clearing the
     * in-memory signature made a live complete plan look stale.
     */
    legacyFetch: Boolean(input.force) || !input.cacheComplete,
  };
}

/**
 * How many times Review used to redraw on a tab entry, versus one settled paint.
 * A cache hit still painted twice (the screen, then planTrip). A miss painted
 * every streamed total.
 * @param {{ force?: boolean, cacheComplete?: boolean, memoryComplete?: boolean, snapshotCount?: number }} [input]
 */
export function reviewEntryPaints(input = {}) {
  const decision = reviewEntryDecision(input);
  const snapshots = Math.max(0, Math.floor(Number(input.snapshotCount) || 0));
  const legacy = decision.legacyFetch ? 1 + snapshots : 2;
  return { now: decision.fetch ? 1 : 1, partials: 0, fetch: decision.fetch, legacy };
}

function memoryStorage() {
  const bag = new Map();
  return {
    getItem: (key) => (bag.has(key) ? bag.get(key) : null),
    setItem: (key, value) => {
      bag.set(key, String(value));
    },
    removeItem: (key) => {
      bag.delete(key);
    },
  };
}

/**
 * Three Review entries for one list. Streamed totals are ignored.
 * A later entry does not call the pricer.
 */
export function createReviewEntrySession() {
  const storage = memoryStorage();
  let memory = null;
  let memorySignature = "";
  let fetches = 0;
  let partialPaints = 0;
  const totals = [];
  return {
    totals,
    get fetches() {
      return fetches;
    },
    get partialPaints() {
      return partialPaints;
    },
    /**
     * @param {{ signature: string, zip: string, now: number, force?: boolean, price: () => object, snapshots?: object[] }} input
     */
    enter(input) {
      const signature = String(input.signature || "");
      const zip = String(input.zip || "");
      const cache = readPlanCache(storage);
      const cacheHit = shouldReusePlan({
        cache,
        signature,
        zip,
        now: input.now,
        force: Boolean(input.force),
      });
      const memoryHit = !input.force && planIsComplete(memory) && memorySignature === signature;
      const decision = reviewEntryDecision({
        force: Boolean(input.force),
        cacheComplete: cacheHit,
        memoryComplete: memoryHit,
        sameList: true,
        sameZip: true,
      });
      if (!decision.fetch) {
        const payload = cacheHit ? cache.payload : memory;
        const total = roundMoney(cartCardFigures(payload.stores).total || payload.total);
        totals.push(total);
        return { total, source: "cache", fetch: false, notes: [] };
      }
      fetches += 1;
      for (const snap of input.snapshots || []) {
        if (!planIsComplete(snap)) {
          /* streamed totals stay off the page */
        } else {
          partialPaints += 1;
        }
      }
      const previous = memory && memorySignature === signature ? memory : null;
      const incoming = input.price();
      const adopted = adoptReviewResult(previous, incoming, input.now);
      const settled = planIsComplete(adopted) ? adopted : planIsComplete(previous) ? previous : null;
      if (!settled) {
        return { total: null, source: "loading", fetch: true, notes: coverageVisible([], { settled: false }) };
      }
      const figures = cartCardFigures(settled.stores);
      memory = { ...settled, stores: figures.stores, total: figures.total, partial: false, pendingStores: [] };
      memorySignature = signature;
      writePlanCache(storage, { signature, zip, payload: memory, savedAt: input.now });
      totals.push(figures.total);
      const notes = coverageVisible(incoming?.coverageNotes, {
        settled: planIsComplete(incoming),
        kept: Boolean(adopted?.keptPreviousPrices),
      });
      return {
        total: figures.total,
        source: adopted === incoming ? "fresh" : "kept",
        fetch: true,
        notes,
      };
    },
  };
}
