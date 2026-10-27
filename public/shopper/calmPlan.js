/**
 * Plain-language trip plan. No scores, ids, or source codes.
 * Money is only repeated from prices the trip already has, and it is
 * labeled as an estimate.
 */

import { formatMoney } from "./savingsMeter.js";
import { consolidateStops, normalizeStoreKey, roundMoney } from "./tripPlan.js";

const SMALL_GAP = 2;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * A price on a tile, list, or plan. The screen's one estimate note
 * carries the "not a receipt" honesty, so the figure itself stays plain.
 * @param {number} amount
 */
export function priceFigure(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "";
  return formatMoney(value);
}

/** @param {number} amount */
export function aboutMoney(amount) {
  const figure = priceFigure(amount);
  return figure ? `about ${figure}` : "";
}

export const ESTIMATE_NOTE = "Prices are estimates. Not a receipt.";

/**
 * Quiet swap line. Substitutions stay off the catalog tiles.
 * @param {{ matchKind?: string, swapNote?: string, substitutedFor?: string, query?: string, name?: string, storeName?: string }} item
 */
export function plainSwap(item) {
  const swapped = item?.matchKind === "swap" || item?.matchKind === "substitute";
  if (!swapped) return null;
  const from = clean(item.substitutedFor || item.query);
  const to = clean(item.name);
  const store = clean(item.storeName) || "the store";
  if (!from || !to) return null;
  return { text: `We swapped ${from} for ${to} at ${store}`, change: "Change" };
}

/**
 * A short note when the price is not a shelf price. Live prices stay quiet.
 * @param {string | undefined} source
 */
export function calmPriceNote(source) {
  switch (source) {
    case "weekly_ad":
    case "cached_weekly_ad":
      return "this week's ad";
    case "seed":
      return "";
    case "unavailable":
      return "price unavailable";
    default:
      return "";
  }
}

/** Operator setup (env vars, API docs, feed configuration) stays off the shopper screen. */
const OPERATOR_COPY =
  /FLIPP_|WALMART_|KROGER_|TARGET_|ACCESS_TOKEN|CONSUMER_ID|PRIVATE_KEY|api\.flipp\.com|walmart\.io|FlyerKit|partner feed|configured|Open Coverage/i;

/** @param {string | null | undefined} text */
export function shopperCopy(text) {
  const value = clean(text);
  if (!value || OPERATOR_COPY.test(value)) return "";
  return value;
}

/**
 * One quiet line for the shelf. No store-setup instructions.
 * @param {{ demo?: boolean, zipOk?: boolean, weeklyAds?: boolean }} state
 */
export function shelfNote(state) {
  if (!state?.zipOk && state?.weeklyAds) return "Add a ZIP to see this week's ads.";
  if (state?.demo) return "Sample prices. Not a receipt.";
  if (state?.weeklyAds) return "Some prices are from this week's ad. Not a receipt.";
  return ESTIMATE_NOTE;
}

/**
 * One-store total versus the split plan.
 * @param {{ splitTotal?: number, savings?: number, singleStore?: { storeName: string, total: number } | null }} comparison
 */
export function savingsCard(comparison) {
  const split = roundMoney(Number(comparison?.splitTotal));
  const one = comparison?.singleStore || null;
  const note = ESTIMATE_NOTE;
  if (!Number.isFinite(Number(comparison?.splitTotal))) {
    return {
      title: "We'll price this when the stores answer",
      lines: [],
      saved: "",
      note,
    };
  }
  if (!one) {
    return {
      title: "No one store has this whole list",
      lines: [{ label: "This plan", value: priceFigure(split) }],
      saved: "We'll keep the stops that actually have the items.",
      note,
    };
  }
  const saved = roundMoney(Number(comparison?.savings) || 0);
  let savedText = "Same total as one store.";
  if (saved > 0.009) savedText = `You save ${priceFigure(saved)}.`;
  else if (saved < -0.009) savedText = `This plan costs ${priceFigure(Math.abs(saved))} more than one store.`;
  return {
    title: "One store or this plan",
    lines: [
      { label: `Everything at ${one.storeName}`, value: priceFigure(one.total) },
      { label: "This plan", value: priceFigure(split) },
    ],
    saved: savedText,
    note,
  };
}

function sameStore(left, right) {
  return normalizeStoreKey(left) === normalizeStoreKey(right);
}

/**
 * Offer fewer stops only when the price difference is small.
 * @param {Array<{ storeName: string, items?: object[], subtotal?: number }>} stores
 * @param {object} [capabilities]
 */
export function fewerStopsOffer(stores, capabilities = {}) {
  const groups = (stores || []).filter((store) => (store.items || []).length);
  if (groups.length < 2) return null;
  const currentTotal = roundMoney(groups.reduce((sum, store) => sum + Number(store.subtotal || 0), 0));
  const next = consolidateStops(groups, SMALL_GAP + 0.01, capabilities);
  if (!next?.stores || next.stores.length >= groups.length) return null;
  const delta = roundMoney(Number(next.total) - currentTotal);
  if (Math.abs(delta) > SMALL_GAP) return null;
  const original = new Map();
  for (const store of groups) {
    for (const item of store.items || []) {
      if (item?.lineId) original.set(item.lineId, item.storeName);
    }
  }
  /** @type {Record<string, string>} */
  const moves = {};
  for (const store of next.stores) {
    for (const item of store.items || []) {
      if (!item?.lineId) continue;
      const from = original.get(item.lineId);
      if (from && !sameStore(from, item.storeName)) moves[item.lineId] = item.storeName;
    }
  }
  if (!Object.keys(moves).length) return null;
  let text;
  if (Math.abs(delta) < 0.009) text = "Fewer stops would cost about the same. Only if that sounds easier.";
  else if (delta > 0) text = `Fewer stops would cost ${priceFigure(delta)} more. Only if that sounds easier.`;
  else text = `Fewer stops would cost ${priceFigure(Math.abs(delta))} less. Only if that sounds easier.`;
  return {
    text,
    action: "Use fewer stops",
    moves,
    delta,
    stops: next.stores.length,
    total: next.total,
  };
}
