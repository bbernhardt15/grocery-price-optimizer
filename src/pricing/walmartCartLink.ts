/**
 * Walmart add-to-cart deep link.
 *
 * The Add To Cart service works for partners whether or not they are
 * onboarded to Impact. It does not require WALMART_PUBLISHER_ID.
 *
 *   https://www.walmart.com/sc/cart/addToCart
 *     ?items={itemId}|{qty},{itemId}
 *     &offers={offerId}|{qty}
 *     &storeId={fulfillmentStoreId}
 *     &ap={accessPointId}
 *
 * `items` is comma-separated `itemId|qty`. Quantity 1 may be the bare
 * itemId. `items` is required when `offers` is not passed.
 * `offers` is comma-separated `offerId|qty` and is an alternative to
 * `items`. This builder sends `offers` only when the caller already has
 * offer ids and has no numeric item ids.
 * `storeId` is the fulfillmentStoreId for the access point.
 * `ap` is the accessPointId from the store locator.
 * Both are omitted when unknown.
 *
 * A link that includes an item Walmart cannot add shows an error modal
 * and sends the shopper to the Walmart home page. Callers must drop
 * lines that lack a numeric item id before opening the link.
 *
 * Attribution, when WALMART_PUBLISHER_ID is set, still uses the Impact
 * template Walmart publishes on productTrackingUrl. The wrapped `u`
 * value is this add-to-cart URL:
 *   https://goto.walmart.com/c/{publisherId}/568844/9383?veh=aff&sourceid=imp_000011112222333344&u={encoded destination}
 * Source: https://walmart.io/apidocs/affiliates/reviews
 * (`productTrackingUrl` example). 568844 / 9383 are Walmart's Impact
 * campaign and ad ids in that example. `sourceid=imp_000011112222333344`
 * is the placeholder in the same example; the publisher id in the path is
 * what identifies the affiliate.
 */

export const WALMART_ADD_TO_CART_URL = "https://www.walmart.com/sc/cart/addToCart";

/** Impact campaign id from Walmart's published productTrackingUrl template. */
export const WALMART_IMPACT_CAMPAIGN_ID = "568844";
/** Impact ad id from Walmart's published productTrackingUrl template. */
export const WALMART_IMPACT_AD_ID = "9383";
/** Placeholder sourceid from Walmart's published productTrackingUrl example. */
export const WALMART_IMPACT_SOURCE_ID = "imp_000011112222333344";

export type WalmartCartLine = {
  /** Numeric Walmart item id. Lines without one are left off the link. */
  itemId?: string;
  /** Offer id, used only when the line has no numeric item id. */
  offerId?: string;
  quantity: number;
};

export type WalmartAddToCartOptions = {
  /** fulfillmentStoreId from the store locator. Sent as `storeId`. */
  storeId?: string;
  /** accessPointId from the store locator. Sent as `ap`. */
  accessPointId?: string;
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

/** Quantity 1 is the bare id. Larger quantities use id|qty. */
function formatIdQty(id: string, quantity: number): string {
  const qty = cartQuantity(quantity);
  return qty === 1 ? id : `${id}|${qty}`;
}

function numericItemId(value: string | undefined): string | undefined {
  const id = value?.trim() ?? "";
  return /^\d+$/.test(id) ? id : undefined;
}

/** Offer ids are opaque tokens. Pipes and commas would break the list. */
function offerToken(value: string | undefined): string | undefined {
  const id = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : undefined;
}

function numericStoreId(value: string | undefined): string | undefined {
  const id = value?.trim() ?? "";
  return /^\d+$/.test(id) ? id : undefined;
}

function accessPointToken(value: string | undefined): string | undefined {
  const id = value?.trim() ?? "";
  return /^[A-Za-z0-9-]+$/.test(id) ? id : undefined;
}

/**
 * Unwrapped add-to-cart URL. Returns undefined when nothing valid remains.
 * Lines without a numeric item id are dropped. Offer ids are used only
 * when no numeric item id is present on the request.
 */
export function walmartAddToCartDestination(
  lines: WalmartCartLine[],
  options: WalmartAddToCartOptions = {}
): string | undefined {
  const itemPairs: string[] = [];
  const offerPairs: string[] = [];
  for (const line of lines) {
    const itemId = numericItemId(line.itemId);
    if (itemId) {
      itemPairs.push(formatIdQty(itemId, line.quantity));
      continue;
    }
    const offerId = offerToken(line.offerId);
    if (offerId) {
      offerPairs.push(formatIdQty(offerId, line.quantity));
    }
  }

  const params = new URLSearchParams();
  if (itemPairs.length > 0) {
    params.set("items", itemPairs.join(","));
  } else if (offerPairs.length > 0) {
    params.set("offers", offerPairs.join(","));
  } else {
    return undefined;
  }

  const storeId = numericStoreId(options.storeId);
  if (storeId) {
    params.set("storeId", storeId);
  }
  const accessPointId = accessPointToken(options.accessPointId);
  if (accessPointId) {
    params.set("ap", accessPointId);
  }

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
 * the plain walmart.com URL, which still adds the items.
 * `storeId` and `ap` are included only when the caller already knows them.
 */
export function walmartAddToCartUrl(
  lines: WalmartCartLine[],
  publisherId?: string,
  options?: WalmartAddToCartOptions
): string | undefined {
  const destination = walmartAddToCartDestination(lines, options);
  if (!destination) {
    return undefined;
  }
  const publisher = publisherId?.trim();
  if (!publisher) {
    return destination;
  }
  return walmartImpactTrackingUrl(destination, publisher);
}
