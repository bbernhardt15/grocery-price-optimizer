/**
 * Short place line for a ZIP the shopper already saved.
 * Unknown ZIPs stay as the five digits. Nothing here calls a network.
 */

/**
 * Exact ZIPs. 45202 is downtown Cincinnati.
 * 45103 is Batavia in Clermont County, a catalog seed ZIP, not 45202.
 * @type {Record<string, string>}
 */
const EXACT = {
  "45102": "Amelia",
  "45103": "Batavia",
  "45201": "Cincinnati",
  "45202": "Cincinnati",
  "45203": "Cincinnati",
  "45204": "Cincinnati",
  "45205": "Cincinnati",
  "45206": "Cincinnati",
  "45207": "Cincinnati",
  "45208": "Cincinnati",
  "45209": "Cincinnati",
  "45211": "Cincinnati",
  "45212": "Cincinnati",
  "45213": "Cincinnati",
  "45214": "Cincinnati",
  "45215": "Cincinnati",
  "45216": "Cincinnati",
  "45217": "Cincinnati",
  "45219": "Cincinnati",
  "45220": "Cincinnati",
  "45223": "Cincinnati",
  "45224": "Cincinnati",
  "45225": "Cincinnati",
  "45226": "Cincinnati",
  "45227": "Cincinnati",
  "45229": "Cincinnati",
  "45230": "Cincinnati",
  "45231": "Cincinnati",
  "45232": "Cincinnati",
  "45233": "Cincinnati",
  "45236": "Cincinnati",
  "45237": "Cincinnati",
  "45238": "Cincinnati",
  "45239": "Cincinnati",
  "45240": "Cincinnati",
  "45241": "Cincinnati",
  "45242": "Cincinnati",
  "45243": "Cincinnati",
  "45244": "Cincinnati",
  "45245": "Cincinnati",
  "45246": "Cincinnati",
  "45247": "Cincinnati",
  "45248": "Cincinnati",
  "45249": "Cincinnati",
  "45251": "Cincinnati",
  "45255": "Cincinnati",
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
