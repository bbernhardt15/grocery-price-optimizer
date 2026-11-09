import { eligibleBits, eligibleCount, zctaBits, zctaCount } from "./serviceAreaData";

/** Shown when a ZIP is outside the Kroger-family + Walmart launch area. */
export const OUT_OF_AREA_MESSAGE =
  "Grocery Gitter isn’t available in your area yet — we need a Kroger-family store and a Walmart nearby";

export const NOT_IN_SERVICE_AREA_CODE = "not_in_service_area";

export { eligibleCount, zctaCount };

export type ServiceArea =
  | { ok: true; zip: string; via: "zcta" | "zip3" }
  | { ok: false; zip: string; reason: "blank" | "invalid" | "out_of_area" };

let eligibleBytes: Uint8Array | null = null;
let zctaBytes: Uint8Array | null = null;

function decodeBits(encoded: string): Uint8Array {
  const buffer = Buffer.from(encoded, "base64");
  return Uint8Array.from(buffer);
}

function eligible(): Uint8Array {
  if (!eligibleBytes) eligibleBytes = decodeBits(eligibleBits);
  return eligibleBytes;
}

function zcta(): Uint8Array {
  if (!zctaBytes) zctaBytes = decodeBits(zctaBits);
  return zctaBytes;
}

function hasBit(bytes: Uint8Array, n: number): boolean {
  if (n < 0 || n > 99999) return false;
  return ((bytes[n >> 3] >> (n & 7)) & 1) === 1;
}

function prefixHasEligible(n: number): boolean {
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
 */
export function serviceAreaFor(value: unknown): ServiceArea {
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

export function inServiceArea(value: unknown): boolean {
  return serviceAreaFor(value).ok;
}

/** The shopper sentence for an out-of-area ZIP. Blank and partial ZIPs return "". */
export function outOfAreaMessage(value: unknown): string {
  const area = serviceAreaFor(value);
  if (area.ok || area.reason !== "out_of_area") return "";
  return OUT_OF_AREA_MESSAGE;
}

export const PLAN_ZIP_ERROR = "zipCode must be a 5-digit ZIP, optionally with a +4 extension.";

const PLAN_ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/;

export type PlanZip =
  | { ok: true; zip: string }
  | { ok: false; status: 400; error: string }
  | { ok: false; status: 422; error: string; code: typeof NOT_IN_SERVICE_AREA_CODE };

/** A plan request needs a real 5-digit ZIP inside the service area. */
export function requirePlanZip(value: unknown): PlanZip {
  let text = "";
  if (typeof value === "number" && Number.isFinite(value)) {
    text = String(Math.trunc(value));
  } else if (typeof value === "string") {
    text = value.trim();
  } else if (value !== undefined && value !== null) {
    return { ok: false, status: 400, error: PLAN_ZIP_ERROR };
  }
  if (!PLAN_ZIP_PATTERN.test(text)) {
    return { ok: false, status: 400, error: PLAN_ZIP_ERROR };
  }
  const area = serviceAreaFor(text);
  if (!area.ok) {
    return {
      ok: false,
      status: 422,
      error: OUT_OF_AREA_MESSAGE,
      code: NOT_IN_SERVICE_AREA_CODE,
    };
  }
  return { ok: true, zip: area.zip };
}
