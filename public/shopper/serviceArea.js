import { eligibleBits, zctaBits } from "./serviceAreaData.js";

/** Shown when a ZIP is outside the Kroger-family + Walmart launch area. */
export const OUT_OF_AREA_MESSAGE =
  "Grocery Gitter isn’t available in your area yet — we need a Kroger-family store and a Walmart nearby";

export const NOT_IN_SERVICE_AREA_CODE = "not_in_service_area";

let eligibleBytes = null;
let zctaBytes = null;

function decodeBits(encoded) {
  const bin = atob(encoded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function eligible() {
  if (!eligibleBytes) eligibleBytes = decodeBits(eligibleBits);
  return eligibleBytes;
}

function zcta() {
  if (!zctaBytes) zctaBytes = decodeBits(zctaBits);
  return zctaBytes;
}

function hasBit(bytes, n) {
  if (n < 0 || n > 99999) return false;
  return ((bytes[n >> 3] >> (n & 7)) & 1) === 1;
}

function prefixHasEligible(n) {
  const base = Math.floor(n / 100) * 100;
  const bytes = eligible();
  for (let i = 0; i < 100; i += 1) {
    if (hasBit(bytes, base + i)) return true;
  }
  return false;
}

/**
 * Launch area: a Census ZCTA whose center is within 10 miles of both a
 * Kroger-family store and a Walmart Supercenter or Neighborhood Market.
 * A ZIP with no ZCTA (PO box or unique) is allowed when that 3-digit
 * prefix contains an eligible ZCTA. A known ZCTA that missed the 10-mile
 * list stays out, even if a neighbor in the same prefix is in.
 * @param {unknown} value
 */
export function serviceAreaFor(value) {
  const raw = typeof value === "number" && Number.isFinite(value) ? String(Math.trunc(value)) : String(value ?? "");
  if (!raw.trim()) return { ok: false, zip: "", reason: "blank" };
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 5) return { ok: false, zip: digits, reason: "invalid" };
  const zip = digits.slice(0, 5);
  const n = Number(zip);
  if (hasBit(eligible(), n)) return { ok: true, zip, via: "zcta" };
  if (hasBit(zcta(), n)) return { ok: false, zip, reason: "out_of_area" };
  if (prefixHasEligible(n)) return { ok: true, zip, via: "zip3" };
  return { ok: false, zip, reason: "out_of_area" };
}

/** @param {unknown} value */
export function inServiceArea(value) {
  return serviceAreaFor(value).ok;
}

/** The shopper sentence for an out-of-area ZIP. Blank and partial ZIPs return "". */
export function outOfAreaMessage(value) {
  const area = serviceAreaFor(value);
  if (area.ok || area.reason !== "out_of_area") return "";
  return OUT_OF_AREA_MESSAGE;
}

/** Five-digit ZIP when it is in the service area, otherwise "". */
export function catalogZip(value) {
  const area = serviceAreaFor(value);
  return area.ok ? area.zip : "";
}

/** Path plus zip=, or "" when the ZIP cannot see store prices. */
export function withServiceZip(path, value) {
  const zip = catalogZip(value);
  if (!zip) return "";
  const join = String(path).includes("?") ? "&" : "?";
  return `${path}${join}zip=${encodeURIComponent(zip)}`;
}
