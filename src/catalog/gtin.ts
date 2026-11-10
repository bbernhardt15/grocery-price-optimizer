/**
 * One GTIN for every store.
 *
 * Walmart UPC-A is 12 digits and includes the check digit. Kroger's productId
 * is 13 digits with that check digit removed and the 11-digit body padded on
 * the left. A Kroger id sometimes still passes the GS1 check by accident;
 * that last digit is data, not a check digit. UPC-E expands to UPC-A. EAN-13
 * and GTIN-14 keep their check digit. The canonical value is GTIN-14.
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

export type ParsedGtin = {
  /** 14 digits, including the computed check digit. */
  gtin14: string;
  /** 12-digit UPC-A including the check digit, when this is a UPC. */
  upcA: string;
  /** 11-digit UPC body. The check digit is not included. */
  upcBody: string;
};

function fromUpcBody(body11: string): ParsedGtin | null {
  if (!/^\d{11}$/.test(body11)) return null;
  const upcA = `${body11}${gtinCheckDigit(body11)}`;
  return { upcBody: body11, upcA, gtin14: `00${upcA}` };
}

function validUpcA(digits12: string): boolean {
  return digits12.length === 12 && hasGtinCheckDigit(digits12);
}

/**
 * Read a retailer code as one UPC.
 * Returns null for item ids and other short numbers.
 */
export function parseGtin(value: string | null | undefined): ParsedGtin | null {
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  const expanded = expandUpcE(digits);
  if (expanded) digits = expanded;
  if (!digits || digits.length > 14) return null;

  // A JSON number drops the leading zero of a UPC-A (`049000042566` → `49000042566`).
  if (digits.length === 11 && digits[0] !== "0") {
    digits = `0${digits}`;
  }

  if (digits.length === 12) {
    if (!hasGtinCheckDigit(digits)) return null;
    return fromUpcBody(digits.slice(0, 11));
  }

  if (digits.length === 13) {
    if (digits[0] !== "0") return null;
    const leadingZeros = digits.match(/^0*/)?.[0].length ?? 0;
    const wrapped = digits.slice(1);
    // 0 + UPC-A is an EAN-13. A Kroger id is an 11-digit body padded to 13,
    // so three or more leading zeros are padding, even when the last digit
    // happens to pass the GS1 check.
    if (leadingZeros < 3 && validUpcA(wrapped)) {
      return fromUpcBody(wrapped.slice(0, 11));
    }
    return fromUpcBody(digits.slice(-11));
  }

  if (digits.length === 14 && hasGtinCheckDigit(digits)) {
    const wrapped = digits.slice(2);
    if (digits.startsWith("00") && validUpcA(wrapped)) {
      return fromUpcBody(wrapped.slice(0, 11));
    }
    if (digits.startsWith("00")) return fromUpcBody(wrapped.slice(0, 11));
    return fromUpcBody(digits.slice(2, 13));
  }

  if (digits.length === 14) return null;

  // Legacy join keys are the UPC body with leading zeros removed (10 or 11 digits).
  if (digits.length === 10 || (digits.length === 11 && digits[0] === "0")) {
    return fromUpcBody(digits.padStart(11, "0"));
  }

  return null;
}

/** GTIN-14 with a computed check digit. */
export function canonicalGtin14(value: string | null | undefined): string | null {
  return parseGtin(value)?.gtin14 ?? null;
}

/**
 * Join key shared by Walmart and Kroger. Significant digits of the UPC body,
 * so a 12-digit UPC-A and Kroger's 13-digit no-check id land on one key.
 */
export function gtinJoinKey(value: string | null | undefined): string | null {
  const parsed = parseGtin(value);
  if (!parsed) return null;
  const stripped = parsed.upcBody.replace(/^0+/, "");
  return stripped.length > 0 ? stripped : null;
}
