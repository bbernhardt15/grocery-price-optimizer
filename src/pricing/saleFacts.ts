/**
 * Sale facts we are willing to show. A badge appears only when a price
 * source already says the item is on sale. The old price and the end date
 * are included only when that same source sent them.
 */

export type SaleFacts = {
  onSale: true;
  /** Previous price, present only when it is higher than the selling price. */
  regularPrice?: number;
  /** Calendar day the sale ends, YYYY-MM-DD, when the source sent a date. */
  saleEndsOn?: string;
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Keep a calendar day from a date or an ISO timestamp without shifting it. */
export function saleEndDay(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const leading = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  const day = leading?.[1];
  if (!day || !DAY.test(day)) return undefined;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed)) return undefined;
  return day;
}

/**
 * Publish a sale only when `onSale` is already true. A regular price at or
 * below the selling price is dropped so the badge cannot invent a discount.
 */
export function publishSale(input: {
  price: number;
  onSale?: boolean;
  regularPrice?: number;
  saleEndsOn?: string;
}): SaleFacts | undefined {
  if (input.onSale !== true) return undefined;
  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) return undefined;
  const regular = Number(input.regularPrice);
  const was = Number.isFinite(regular) && regular > price ? roundMoney(regular) : undefined;
  const saleEndsOn = saleEndDay(input.saleEndsOn);
  return {
    onSale: true,
    ...(was != null ? { regularPrice: was } : {}),
    ...(saleEndsOn ? { saleEndsOn } : {}),
  };
}

/** Kroger Products API: promo is the selling price, regular is the old price. */
export function krogerSale(price: number, regular: unknown, promo: unknown): SaleFacts | undefined {
  const promoPrice = typeof promo === "number" && promo > 0 ? promo : undefined;
  const regularPrice = typeof regular === "number" && regular >= 0 ? regular : undefined;
  const selling = promoPrice ?? regularPrice;
  if (selling == null || roundMoney(selling) !== roundMoney(price)) return undefined;
  const onSale = promoPrice != null && (regularPrice == null || promoPrice < regularPrice);
  return publishSale({ price, onSale, regularPrice });
}

/** Walmart Affiliate: salePrice is the current price. msrp is a was-price only when it is higher. */
export function walmartSale(price: number, salePrice: unknown, msrp: unknown): SaleFacts | undefined {
  if (typeof salePrice !== "number" || typeof msrp !== "number") return undefined;
  if (!(msrp > salePrice) || roundMoney(salePrice) !== roundMoney(price)) return undefined;
  return publishSale({ price, onSale: true, regularPrice: msrp });
}
