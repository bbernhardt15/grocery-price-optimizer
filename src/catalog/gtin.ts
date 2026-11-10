/**
 * One GTIN for every store.
 *
 * Walmart's UPC field is a 12-digit UPC-A and already includes the check
 * digit. Kroger's productId is always a 13-digit code with that check digit
 * removed. The reader decides which rule to use from the source field, not
 * from leading zeros and not from whether the last digit happens to pass GS1.
 *
 * A GTIN-14 whose indicator digit is 0 is the consumer unit and collapses to
 * that UPC. Indicator digits 1 through 8 are cases and stay distinct.
 * Indicator 9, number-system 2, and PLU codes are not given a key.
 *
 * Left out on purpose: a 13-digit code that does not start with 0, and an
 * 8-digit code that is not UPC-E. Receipt lines in this app store 13-digit
 * in-store codes (see `krogerCode` in the receipt tests). Treating every
 * valid-check 13-digit string as an EAN-13 would rekey those rows. An 8-digit
 * string is read only as UPC-E; a plain EAN-8 is not a code this catalog sells,
 * and it is ambiguous with a zero-stripped UPC-E. Both stay unparsed.
 */

export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    const digit = Number(body[body.length - 1 - index]);
    sum += digit * (index % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function hasGtinCheckDigit(digits: string): boolean {
  if (digits.length < 2) return false;
  return gtinCheckDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}

function upcAFromUpcE(numberSystem: string, middle: string): string | null {
  if ((numberSystem !== "0" && numberSystem !== "1") || !/^\d{6}$/.test(middle)) return null;
  const digit = middle.split("");
  const last = digit[5];
  let body: string;
  if (last === "0" || last === "1" || last === "2") {
    body = `${numberSystem}${digit[0]}${digit[1]}${last}0000${digit[2]}${digit[3]}${digit[4]}`;
  } else if (last === "3") {
    body = `${numberSystem}${digit[0]}${digit[1]}${digit[2]}00000${digit[3]}${digit[4]}`;
  } else if (last === "4") {
    body = `${numberSystem}${digit[0]}${digit[1]}${digit[2]}${digit[3]}00000${digit[4]}`;
  } else {
    body = `${numberSystem}${digit[0]}${digit[1]}${digit[2]}${digit[3]}${digit[4]}0000${last}`;
  }
  if (body.length !== 11) return null;
  return `${body}${gtinCheckDigit(body)}`;
}

/** UPC-E expanded to UPC-A. A plain EAN-8 is not expanded. */
export function expandUpcE(upc: string | undefined | null): string | null {
  if (!upc) return null;
  const digits = upc.replace(/\D/g, "");
  if (digits.length === 8 && (digits[0] === "0" || digits[0] === "1")) {
    const expanded = upcAFromUpcE(digits[0], digits.slice(1, 7));
    return expanded?.endsWith(digits[7]) ? expanded : null;
  }
  if (digits.length === 7) {
    const expanded = upcAFromUpcE("0", digits.slice(0, 6));
    return expanded?.endsWith(digits[6]) ? expanded : null;
  }
  return null;
}

export type GtinSource = "upc" | "kroger-product-id";

export type GtinRead = { source?: GtinSource };

export type ParsedGtin = {
  /** 14 digits, including the computed check digit. */
  gtin14: string;
  /** 12-digit UPC-A including the check digit, when this is a consumer UPC. */
  upcA: string;
  /** 11-digit UPC body. The check digit is not included. Empty for a case. */
  upcBody: string;
  /**
   * GTIN-14 packaging indicator. 0 is the consumer unit.
   * 1 through 8 are cases and do not share the consumer key.
   */
  indicator: number;
};

function fromUpcBody(body11: string): ParsedGtin | null {
  if (!/^\d{11}$/.test(body11)) return null;
  // Number system 2 is in-store random weight. It is not a shelf GTIN.
  if (body11[0] === "2") return null;
  const upcA = `${body11}${gtinCheckDigit(body11)}`;
  return { upcBody: body11, upcA, gtin14: `00${upcA}`, indicator: 0 };
}

function validUpcA(digits12: string): boolean {
  return digits12.length === 12 && hasGtinCheckDigit(digits12);
}

function parseKrogerProductId(digits: string): ParsedGtin | null {
  if (!/^\d{13}$/.test(digits)) return null;
  // The check digit was removed. The rightmost 11 digits are the UPC body
  // whether or not the last digit of this 13-digit string passes GS1.
  return fromUpcBody(digits.slice(-11));
}

/**
 * Read a retailer code as one UPC.
 * Pass `{ source: "kroger-product-id" }` for Kroger's productId field.
 * The default source is a UPC or GTIN that already includes its check digit.
 * Returns null for item ids, PLU, random-weight, and other non-GTIN codes.
 */
export function parseGtin(value: string | null | undefined, read?: GtinRead): ParsedGtin | null {
  if (!value) return null;
  if (read?.source === "kroger-product-id") {
    const trimmed = value.trim();
    if (!/^\d{13}$/.test(trimmed)) return null;
    return parseKrogerProductId(trimmed);
  }
  const raw = value.replace(/\D/g, "");
  if (!raw || raw.length > 14) return null;

  let digits = raw;
  const expanded = expandUpcE(digits);
  if (expanded) digits = expanded;

  // A JSON number drops the leading zero of a UPC-A (`049000042566` → `49000042566`).
  if (digits.length === 11 && digits[0] !== "0") {
    digits = `0${digits}`;
  }

  if (digits.length === 12) {
    if (!hasGtinCheckDigit(digits)) return null;
    if (digits[0] === "2") return null;
    return fromUpcBody(digits.slice(0, 11));
  }

  if (digits.length === 13) {
    // A non-zero-prefixed EAN-13 is left unparsed. See the file comment.
    if (digits[0] !== "0") return null;
    const wrapped = digits.slice(1);
    // `0` plus a UPC-A is the EAN form of that UPC. The check digit is present.
    if (validUpcA(wrapped)) return fromUpcBody(wrapped.slice(0, 11));
    return null;
  }

  if (digits.length === 14) {
    if (!hasGtinCheckDigit(digits)) return null;
    const indicator = Number(digits[0]);
    if (indicator === 9) return null;
    if (indicator >= 1 && indicator <= 8) {
      return { gtin14: digits, upcA: "", upcBody: "", indicator };
    }
    if (digits.startsWith("00") && validUpcA(digits.slice(2))) {
      return fromUpcBody(digits.slice(2, 13));
    }
    return null;
  }

  // Legacy join keys are the UPC body with leading zeros removed (10 or 11 digits).
  if (digits.length === 10 || (digits.length === 11 && digits[0] === "0")) {
    return fromUpcBody(digits.padStart(11, "0"));
  }

  return null;
}

/** GTIN-14 with a computed check digit. */
export function canonicalGtin14(value: string | null | undefined, read?: GtinRead): string | null {
  return parseGtin(value, read)?.gtin14 ?? null;
}

/**
 * Join key shared by Walmart and Kroger. Significant digits of the UPC body,
 * so a 12-digit UPC-A and Kroger's 13-digit no-check id land on one key.
 * A case GTIN-14 (indicator 1-8) keeps its own 14-digit key.
 */
export function gtinJoinKey(value: string | null | undefined, read?: GtinRead): string | null {
  const parsed = parseGtin(value, read);
  if (!parsed) return null;
  if (parsed.indicator >= 1) return parsed.gtin14;
  const stripped = parsed.upcBody.replace(/^0+/, "");
  return stripped.length > 0 ? stripped : null;
}
