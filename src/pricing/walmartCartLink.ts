/**
 * Walmart affiliate add-to-cart deep link.
 *
 * Cart URL (works with or without an Impact publisher id):
 *   https://affil.walmart.com/cart/addToCart?items={itemId}|{qty},{itemId}|{qty}
 *
 * That `items` syntax is the affiliate add-to-cart URL carried by the
 * Affiliate item field `addToCartUrl` ("Walmart.com cart page Url with the
 * item added to cart") and wrapped by `affiliateAddToCartUrl` when a
 * publisher id is present. See:
 * - https://walmart.io/docs/affiliates/v1/gm-add-to-cart
 * - https://walmart.io/apidocs/affiliates/item-response-groups
 *   (`addToCartUrl`, `affiliateAddToCartUrl`)
 *
 * Attribution, when WALMART_PUBLISHER_ID is set, uses the Impact template
 * Walmart publishes on productTrackingUrl:
 *   https://goto.walmart.com/c/{publisherId}/568844/9383?veh=aff&sourceid=imp_000011112222333344&u={encoded destination}
 * Source: https://walmart.io/apidocs/affiliates/reviews
 * (`productTrackingUrl` example). 568844 / 9383 are Walmart's Impact
 * campaign and ad ids in that example. `sourceid=imp_000011112222333344`
 * is the placeholder in the same example; the publisher id in the path is
 * what identifies the affiliate. The unwrapped affil.walmart.com URL is
 * used when the publisher id is unset so the cart link still opens.
 */

export const WALMART_ADD_TO_CART_URL = "https://affil.walmart.com/cart/addToCart";

/** Impact campaign id from Walmart's published productTrackingUrl template. */
export const WALMART_IMPACT_CAMPAIGN_ID = "568844";
/** Impact ad id from Walmart's published productTrackingUrl template. */
export const WALMART_IMPACT_AD_ID = "9383";
/** Placeholder sourceid from Walmart's published productTrackingUrl example. */
export const WALMART_IMPACT_SOURCE_ID = "imp_000011112222333344";

export type WalmartCartLine = {
  itemId: string;
  quantity: number;
};

export function readWalmartPublisherId(): string | undefined {
  const publisherId = process.env.WALMART_PUBLISHER_ID?.trim();
  return publisherId || undefined;
}

function cartQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) {
    return 1;
  }
  return Math.max(1, Math.floor(quantity));
}

/**
 * Unwrapped add-to-cart URL. Returns undefined when there is nothing to add.
 * Item ids must already be numeric Walmart item ids.
 */
export function walmartAddToCartDestination(
  lines: WalmartCartLine[]
): string | undefined {
  const pairs: string[] = [];
  for (const line of lines) {
    const itemId = line.itemId.trim();
    if (!/^\d+$/.test(itemId)) {
      return undefined;
    }
    pairs.push(`${itemId}|${cartQuantity(line.quantity)}`);
  }
  if (pairs.length === 0) {
    return undefined;
  }
  const params = new URLSearchParams({ items: pairs.join(",") });
  return `${WALMART_ADD_TO_CART_URL}?${params.toString()}`;
}

/** Wrap a Walmart destination in the documented Impact tracking link. */
export function walmartImpactTrackingUrl(
  destination: string,
  publisherId: string
): string {
  const id = publisherId.trim();
  const params = new URLSearchParams({
    veh: "aff",
    sourceid: WALMART_IMPACT_SOURCE_ID,
    u: destination,
  });
  return `https://goto.walmart.com/c/${encodeURIComponent(id)}/${WALMART_IMPACT_CAMPAIGN_ID}/${WALMART_IMPACT_AD_ID}?${params.toString()}`;
}

/**
 * Shopper-facing cart link. Attributed when `publisherId` is set; otherwise
 * the plain affil.walmart.com URL, which still adds the items.
 */
export function walmartAddToCartUrl(
  lines: WalmartCartLine[],
  publisherId?: string
): string | undefined {
  const destination = walmartAddToCartDestination(lines);
  if (!destination) {
    return undefined;
  }
  const publisher = publisherId?.trim();
  if (!publisher) {
    return destination;
  }
  return walmartImpactTrackingUrl(destination, publisher);
}
