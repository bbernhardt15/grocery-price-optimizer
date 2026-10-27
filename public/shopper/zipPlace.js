/**
 * Short place line for a ZIP the shopper already saved.
 * Unknown ZIPs stay as the five digits. Nothing here calls a network.
 */

/** @type {Record<string, string>} */
const EXACT = {
  "45103": "Cincinnati",
};

/** Sectional centers the shopper is likely to recognize. */
const PREFIXES = {
  100: "New York",
  101: "New York",
  102: "New York",
  103: "New York",
  104: "New York",
  111: "New York",
  112: "New York",
  303: "Atlanta",
  331: "Miami",
  450: "Cincinnati",
  451: "Cincinnati",
  452: "Cincinnati",
  606: "Chicago",
  752: "Dallas",
  770: "Houston",
  900: "Los Angeles",
  902: "Los Angeles",
};

/**
 * @param {string | null | undefined} zip
 * @returns {string}
 */
export function zipPlaceLabel(zip) {
  const digits = String(zip ?? "").replace(/\D/g, "");
  if (digits.length < 5) return "";
  const five = digits.slice(0, 5);
  const place = EXACT[five] || PREFIXES[Number(five.slice(0, 3))];
  return place ? `${place} ${five}` : five;
}
