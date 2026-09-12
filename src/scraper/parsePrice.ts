/**
 * Pulls a shelf price out of messy grocery-site text such as
 * "$4.39", "Regular Price $5.99 Sale price $4.01", or "4,29 €".
 */
export function parsePrice(text: string): number | null {
  const normalized = text.replace(/\u00a0/g, " ").replace(/,/g, "").trim();
  if (!normalized) {
    return null;
  }

  const saleMatch = normalized.match(
    /sale(?:\s+price)?[^0-9$]*\$?\s*(\d+(?:\.\d{1,2})?)/i
  );
  if (saleMatch) {
    return toMoney(saleMatch[1]);
  }

  const dollarMatch = normalized.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollarMatch) {
    return toMoney(dollarMatch[1]);
  }

  const plainMatch = normalized.match(/(\d+\.\d{2})/);
  if (plainMatch) {
    return toMoney(plainMatch[1]);
  }

  return null;
}

function toMoney(value: string): number | null {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return Math.round(amount * 100) / 100;
}
