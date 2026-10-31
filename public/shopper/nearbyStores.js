/**
 * Chains to offer for a ZIP.
 *
 * There is no one locator that covers every banner within 25 miles.
 * A ZIP prefix maps to a state, and each chain is listed when it has
 * stores in that state or delivers there. An unknown ZIP, or a blank
 * one, keeps the full list so the picker is never empty.
 */

import { knownStoreNames } from "./tripPlan.js";

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

const NEARBY_NOTE = "Chains with a store near this ZIP, or that deliver here. Uncheck one to leave it out.";
const ZIP_NOTE = "Add a ZIP to see stores near you. Every chain is listed until then.";
const FALLBACK_NOTE = "We don't have a store map for that ZIP, so every chain is listed. Uncheck one to leave it out.";

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
  const stores = all.filter((name) => chainServesState(name, state));
  if (!stores.length) {
    return { stores: all, source: "fallback", note: FALLBACK_NOTE, state };
  }
  return { stores, source: "nearby", note: NEARBY_NOTE, state };
}
