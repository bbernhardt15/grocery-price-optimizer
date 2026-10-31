/**
 * Chains to offer for a ZIP.
 *
 * A ZIP prefix maps to a state, and a chain is listed only when it
 * operates in that state. Chains that do not cover the whole state
 * (Giant Eagle is in Columbus and Cleveland, not Cincinnati) also need
 * a geocoded market within about 25 miles. Census ZIP centers live in
 * zipCentroids.js. A blank or unknown ZIP still lists every chain.
 */

import { knownStoreNames } from "./tripPlan.js";
import { ZIP3_POINTS, ZIP5_POINTS } from "./zipCentroids.js";

/** Miles from a ZIP to the nearest market. ZIP3 centers are coarser, so the check still uses 25. */
export const STORE_RANGE_MILES = 25;

/** Inclusive ZIP3 ranges. Prefixes that are not listed fall back to every chain. */
const ZIP_STATES = [
  [6, 9, "PR"],
  [10, 27, "MA"],
  [28, 29, "RI"],
  [30, 38, "NH"],
  [39, 49, "ME"],
  [50, 59, "VT"],
  [60, 69, "CT"],
  [70, 89, "NJ"],
  [100, 149, "NY"],
  [150, 196, "PA"],
  [197, 199, "DE"],
  [200, 205, "DC"],
  [206, 219, "MD"],
  [220, 246, "VA"],
  [247, 268, "WV"],
  [270, 289, "NC"],
  [290, 299, "SC"],
  [300, 319, "GA"],
  [320, 349, "FL"],
  [350, 369, "AL"],
  [370, 385, "TN"],
  [386, 397, "MS"],
  [398, 399, "GA"],
  [400, 427, "KY"],
  [430, 459, "OH"],
  [460, 479, "IN"],
  [480, 499, "MI"],
  [500, 528, "IA"],
  [530, 549, "WI"],
  [550, 567, "MN"],
  [570, 577, "SD"],
  [580, 588, "ND"],
  [590, 599, "MT"],
  [600, 629, "IL"],
  [630, 658, "MO"],
  [660, 679, "KS"],
  [680, 693, "NE"],
  [700, 714, "LA"],
  [716, 729, "AR"],
  [730, 749, "OK"],
  [750, 799, "TX"],
  [800, 816, "CO"],
  [820, 831, "WY"],
  [832, 838, "ID"],
  [840, 847, "UT"],
  [850, 865, "AZ"],
  [870, 884, "NM"],
  [885, 885, "TX"],
  [889, 898, "NV"],
  [900, 961, "CA"],
  [967, 968, "HI"],
  [970, 979, "OR"],
  [980, 994, "WA"],
  [995, 999, "AK"],
];

const EVERYWHERE = new Set(["Walmart", "Target"]);

/** States without a warehouse or delivery for an otherwise wide chain. */
const ABSENT = {
  Aldi: ["AK", "HI", "WA", "OR", "MT", "WY"],
  Costco: ["WV", "WY", "MT"],
  "Sam's Club": ["AK", "HI", "VT"],
};

/** States where a regional chain has stores or delivery. */
const PRESENT = {
  Kroger: ["AL", "AR", "AZ", "CA", "CO", "GA", "ID", "IL", "IN", "KY", "LA", "MI", "MO", "MS", "NC", "NM", "NV", "OH", "OR", "SC", "TN", "UT", "VA", "WA", "WV"],
  Publix: ["AL", "FL", "GA", "NC", "SC", "TN", "VA"],
  "H-E-B": ["TX"],
  Meijer: ["IL", "IN", "KY", "MI", "OH", "WI"],
  Safeway: ["AK", "AZ", "CA", "CO", "DC", "HI", "MD", "OR", "VA", "WA"],
  Albertsons: ["AZ", "CA", "CO", "ID", "IL", "LA", "MT", "NV", "NM", "OR", "TX", "UT", "WA", "WY"],
  Vons: ["CA"],
  "Jewel-Osco": ["IA", "IL"],
  Acme: ["DE", "MD", "NJ", "PA"],
  "Tom Thumb": ["TX"],
  Randalls: ["TX"],
  Pavilions: ["CA"],
  "Food Lion": ["DE", "GA", "MD", "NC", "PA", "SC", "TN", "VA", "WV"],
  Giant: ["DC", "DE", "MD", "PA", "VA"],
  "Stop & Shop": ["CT", "MA", "NJ", "NY", "RI"],
  Sprouts: ["AL", "AZ", "CA", "CO", "FL", "GA", "KS", "MD", "MO", "NC", "NM", "NV", "OK", "SC", "TN", "TX", "UT", "VA", "WA"],
  "Winn-Dixie": ["AL", "FL", "GA", "LA", "MS"],
  "Whole Foods": ["AZ", "CA", "CO", "CT", "DC", "FL", "GA", "IL", "MA", "MD", "MI", "MN", "MO", "NC", "NJ", "NV", "NY", "OH", "OR", "PA", "TN", "TX", "VA", "WA"],
  "Amazon Fresh": ["CA", "CT", "DC", "FL", "IL", "MA", "MD", "NJ", "NY", "PA", "TX", "VA", "WA"],
  "Giant Eagle": ["IN", "MD", "OH", "PA", "WV"],
};

const NEARBY_NOTE = "Chains with a store within about 25 miles. Uncheck one to leave it out.";
const ZIP_NOTE = "Add a ZIP to see stores near you. Every chain is listed until then.";
const FALLBACK_NOTE = "We don't have a store map for that ZIP, so every chain is listed. Uncheck one to leave it out.";
const NONE_NOTE = "No listed chain has a store within about 25 miles of this ZIP.";

/**
 * City centers where a chain actually has stores. A state list is too wide
 * for these. Chains that are not here are dense across the states they serve
 * (a store is within about 25 miles), so the state check is enough.
 * @type {Record<string, Array<[number, number]>>}
 */
const MARKETS = {
  "Giant Eagle": [
    [41.5, -81.69],
    [41.08, -81.52],
    [40.8, -81.38],
    [41.1, -80.65],
    [39.96, -83.0],
    [40.44, -80.0],
    [42.13, -80.09],
    [40.79, -77.86],
    [40.33, -78.92],
    [40.06, -80.72],
    [39.63, -79.96],
    [39.77, -86.16],
    [39.65, -78.76],
  ],
};

export function stateForZip(zip) {
  const digits = String(zip || "").replace(/\D/g, "");
  if (digits.length < 5) return "";
  const prefix = Number(digits.slice(0, 3));
  if (!Number.isFinite(prefix)) return "";
  for (const [start, end, state] of ZIP_STATES) {
    if (prefix >= start && prefix <= end) return state;
  }
  return "";
}

export function chainServesState(name, state) {
  if (!state) return false;
  if (EVERYWHERE.has(name)) return true;
  if (ABSENT[name]) return !ABSENT[name].includes(state);
  if (PRESENT[name]) return PRESENT[name].includes(state);
  return false;
}

/** @param {[number, number]} a @param {[number, number]} b */
export function milesBetween(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** @returns {[number, number] | null} */
export function pointForZip(zip) {
  const digits = String(zip || "").replace(/\D/g, "");
  if (digits.length < 5) return null;
  const zip5 = digits.slice(0, 5);
  if (ZIP5_POINTS[zip5]) return ZIP5_POINTS[zip5];
  return ZIP3_POINTS[zip5.slice(0, 3)] || null;
}

/** True when the chain has no tighter footprint, or a market is within about 25 miles. */
export function chainNearZip(name, zip) {
  const markets = MARKETS[name];
  if (!markets?.length) return true;
  const point = pointForZip(zip);
  if (!point) return false;
  return markets.some((market) => milesBetween(point, market) <= STORE_RANGE_MILES);
}

/**
 * @param {string | null | undefined} zip
 * @returns {{ stores: string[], source: "nearby" | "fallback", note: string, state: string }}
 */
export function storesForZip(zip) {
  const all = knownStoreNames();
  const state = stateForZip(zip);
  const digits = String(zip || "").replace(/\D/g, "");
  if (!state) {
    return {
      stores: all,
      source: "fallback",
      note: digits.length >= 5 ? FALLBACK_NOTE : ZIP_NOTE,
      state: "",
    };
  }
  const stores = all.filter((name) => chainServesState(name, state) && chainNearZip(name, digits));
  if (!stores.length) {
    return { stores: [], source: "nearby", note: NONE_NOTE, state };
  }
  return { stores, source: "nearby", note: NEARBY_NOTE, state };
}
