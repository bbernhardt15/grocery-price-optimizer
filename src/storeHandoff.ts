import type { ItemOffer, OptimizeResult, PickedItem, PriceSource, StoreGroup } from "./optimizeGroceryList";
import {
  readWalmartPublisherId,
  walmartAddToCartUrl,
  type WalmartAddToCartOptions,
  type WalmartCartLine,
} from "./pricing/walmartCartLink";
import type { WalmartNearbyStore } from "./pricing/walmartProvider";
import { mappingForStore } from "./pricing/flipp/merchants";
import type { StorePricingReport } from "./pricing/types";
import {
  handoffTierFor,
  priceSourceLabel,
  type HandoffTier,
} from "./storeHandoffConfig";
import { publicCouponLink, type StoreCouponLink } from "./coupons/pages";

export type { HandoffTier } from "./storeHandoffConfig";

export type HandoffActionType =
  | "kroger_cart"
  | "walmart_cart"
  | "shop_list"
  | "search_deeplink"
  | "coming_soon";

export type HandoffActionStatus =
  | "ready"
  | "needs_shopper_login"
  | "coming_soon"
  | "unavailable";

export type HandoffItem = {
  name: string;
  brand: string;
  quantity: number;
  price: number;
  productId?: string;
  upc?: string;
  locationId?: string;
  url?: string;
  priceSource?: PriceSource;
  size?: string;
  lineId?: string;
  department?: string;
  aisle?: string;
  /** "Open in Target" when this item has a store link. */
  openLabel?: string;
};

export type StoreHandoffAction = {
  type: HandoffActionType;
  label: string;
  url?: string;
  status: HandoffActionStatus;
  /** Honest explanation of what the button does and what still needs retailer OAuth. */
  detail?: string;
  /** Search deep link used when cart OAuth is unavailable or Kroger rejects the write. */
  fallbackUrl?: string;
};

export type StoreHandoff = {
  storeName: string;
  /** Configured tier. The action may fall back to a checklist when cart write is unavailable. */
  tier: HandoffTier;
  /** Live shelf price, Weekly ad, Demo catalog, or another honest label. */
  priceLabel: string;
  itemCount: number;
  subtotal: number;
  items: HandoffItem[];
  action: StoreHandoffAction;
  /**
   * The store's own coupon or deals page. Stays on the card even when cart
   * links are held for Pro. Grocery Gitter does not clip these coupons.
   */
  coupon?: StoreCouponLink;
};

/** What the shopper's device needs to rebuild cart links after a move. */
export type TripCapabilities = {
  krogerCart: boolean;
  walmartPublisherId?: string;
  walmartStoreId?: string;
  walmartAccessPointId?: string;
};

export type TripPlan = {
  /** Example: "15 Kroger + 5 Walmart + 10 Target" */
  summary: string;
  storeCount: number;
  itemCount: number;
};

export type EnrichedStoreGroup = StoreGroup & {
  itemCount: number;
  handoff: StoreHandoff;
  pricing?: StorePricingReport;
  /** Nearest Walmart from the Affiliate Store Locator, when a ZIP lookup succeeded. */
  nearbyStore?: WalmartNearbyStore;
};

export type EnrichedOptimizeResult = OptimizeResult & {
  stores: EnrichedStoreGroup[];
  tripPlan: TripPlan;
  pricingByStore?: StorePricingReport[];
  capabilities: TripCapabilities;
};

export type HandoffOptions = {
  /**
   * True only when KROGER_REDIRECT_URI (and client id/secret) are set so the
   * authorization-code + Cart API path can be offered. Client-credentials
   * used for Products/Locations are not sufficient.
   */
  krogerCartOAuthConfigured?: boolean;
  pricingByStore?: StorePricingReport[];
  /**
   * Nearest Walmart for this request's ZIP. Labels the card and sets
   * add-to-cart storeId / ap when the locator sent them. Prices stay catalog.
   */
  walmartStore?: WalmartNearbyStore;
};

const KROGER_SEARCH = "https://www.kroger.com/search";
const WALMART_SEARCH = "https://www.walmart.com/search";
const TARGET_SEARCH = "https://www.target.com/s";
export const KROGER_CART_START_PATH = "/api/kroger/cart/start";

type RetailerKey =
  | "kroger"
  | "walmart"
  | "target"
  | "aldi"
  | "publix"
  | "heb"
  | "meijer"
  | "safeway"
  | "albertsons"
  | "food_lion"
  | "giant"
  | "stop_and_shop"
  | "costco"
  | "sams_club"
  | "whole_foods"
  | "amazon_fresh"
  | "other";

function retailerKey(storeName: string): RetailerKey {
  const name = storeName
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (name === "kroger") return "kroger";
  if (name === "walmart") return "walmart";
  if (name === "target") return "target";
  if (name === "aldi") return "aldi";
  if (name === "publix") return "publix";
  if (name === "h e b" || name === "heb") return "heb";
  if (name === "meijer") return "meijer";
  if (name === "safeway") return "safeway";
  if (name === "albertsons") return "albertsons";
  if (name === "food lion") return "food_lion";
  if (name === "giant" || name === "giant food") return "giant";
  if (name === "stop and shop") return "stop_and_shop";
  if (name === "costco") return "costco";
  if (name === "sams club") return "sams_club";
  if (name === "whole foods" || name === "whole foods market") return "whole_foods";
  if (name === "amazon fresh") return "amazon_fresh";
  return "other";
}

function canonicalRetailer(
  storeName: string
): "kroger" | "walmart" | "target" | "aldi" | "other" {
  const key = retailerKey(storeName);
  if (key === "kroger" || key === "walmart" || key === "target" || key === "aldi") {
    return key;
  }
  return "other";
}

export function itemCountOf(items: Array<{ quantity: number }>): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function formatTripSummary(
  stores: Array<{ storeName: string; itemCount: number }>
): string {
  if (stores.length === 0) {
    return "No stores matched this list.";
  }

  return stores
    .map((store) => `${store.itemCount} ${store.storeName}`)
    .join(" + ");
}

function flyerOrSeed(item: { priceSource?: PriceSource }): boolean {
  return item.priceSource === "weekly_ad" || item.priceSource === "seed";
}

function identifierOf(
  item: Pick<PickedItem, "productId" | "upc" | "name" | "priceSource">
): string {
  if (flyerOrSeed(item)) {
    return item.name.trim();
  }
  return (item.upc || item.productId || item.name).trim();
}

export function krogerSearchUrl(
  item: Pick<PickedItem, "productId" | "upc" | "name" | "priceSource">
): string {
  const query = new URLSearchParams({ query: identifierOf(item) });
  return `${KROGER_SEARCH}?${query.toString()}`;
}

export function walmartSearchUrl(
  item: Pick<PickedItem, "productId" | "upc" | "name" | "priceSource">
): string {
  const productId = flyerOrSeed(item) ? "" : item.productId?.trim();
  if (productId) {
    return `https://www.walmart.com/ip/${encodeURIComponent(productId)}`;
  }
  const query = new URLSearchParams({ q: (item.upc || item.name).trim() });
  return `${WALMART_SEARCH}?${query.toString()}`;
}

export function targetSearchUrl(
  item: Pick<PickedItem, "productId" | "upc" | "name" | "priceSource">
): string {
  const productId = flyerOrSeed(item) ? "" : item.productId?.trim();
  if (productId) {
    return `https://www.target.com/p/-/A-${encodeURIComponent(productId)}`;
  }
  const query = new URLSearchParams({
    searchTerm: (item.upc || item.name).trim(),
  });
  return `${TARGET_SEARCH}?${query.toString()}`;
}

function searchQuery(
  item: Pick<PickedItem, "productId" | "upc" | "name" | "priceSource">
): string {
  if (flyerOrSeed(item)) {
    return item.name.trim();
  }
  return (item.upc || item.productId || item.name).trim();
}

/** Aldi's public shop search. Indexed example: https://www.aldi.us/store/aldi/s?k=milk */
export function aldiSearchUrl(
  item: Pick<PickedItem, "productId" | "upc" | "name" | "priceSource">
): string {
  return `https://www.aldi.us/store/aldi/s?k=${encodeURIComponent(searchQuery(item))}`;
}

/** Public storefront search — not a cart fill. */
export function partnerSearchUrl(
  storeName: string,
  item: Pick<PickedItem, "productId" | "upc" | "name" | "priceSource">
): string | undefined {
  const q = encodeURIComponent(searchQuery(item));
  const configured = mappingForStore(storeName)?.searchUrl;
  if (configured) {
    return configured.includes("{q}") ? configured.replaceAll("{q}", q) : configured;
  }
  switch (retailerKey(storeName)) {
    case "publix":
      return `https://www.publix.com/search?searchTerm=${q}`;
    case "heb":
      return `https://www.heb.com/search/?q=${q}`;
    case "meijer":
      return `https://www.meijer.com/shopping/search.html?text=${q}`;
    case "safeway":
      return `https://www.safeway.com/shop/search-results.html?q=${q}`;
    case "albertsons":
      return `https://www.albertsons.com/shop/search-results.html?q=${q}`;
    case "food_lion":
      return `https://shop.foodlion.com/search?search_term=${q}`;
    case "giant":
      return "https://giantfood.com/";
    case "stop_and_shop":
      return "https://stopandshop.com/";
    case "costco":
      return `https://www.costco.com/CatalogSearch?keyword=${q}`;
    case "sams_club":
      return `https://www.samsclub.com/s/${q}`;
    case "whole_foods":
      return `https://www.wholefoodsmarket.com/search?text=${q}`;
    case "amazon_fresh":
      return `https://www.amazon.com/s?k=${q}`;
    default:
      return undefined;
  }
}

function itemSearchUrl(
  storeName: string,
  item: Pick<PickedItem, "productId" | "upc" | "name" | "priceSource">
): string | undefined {
  if (handoffTierFor(storeName) === "list") {
    return undefined;
  }
  switch (retailerKey(storeName)) {
    case "kroger":
      return krogerSearchUrl(item);
    case "walmart":
      return walmartSearchUrl(item);
    case "target":
      return targetSearchUrl(item);
    case "aldi":
      return aldiSearchUrl(item);
    default:
      return partnerSearchUrl(storeName, item);
  }
}

function toHandoffItem(storeName: string, item: PickedItem): HandoffItem {
  const url = itemSearchUrl(storeName, item);
  const aisle = item.aisle;
  return {
    name: item.name,
    brand: item.brand,
    quantity: item.quantity,
    price: item.price,
    ...(item.productId ? { productId: item.productId } : {}),
    ...(item.upc ? { upc: item.upc } : {}),
    ...(item.locationId ? { locationId: item.locationId } : {}),
    ...(item.size ? { size: item.size } : {}),
    ...(item.lineId ? { lineId: item.lineId } : {}),
    ...(item.department ? { department: item.department } : {}),
    ...(aisle ? { aisle } : {}),
    ...(url ? { url, openLabel: `Open in ${storeName}` } : {}),
    ...(item.priceSource ? { priceSource: item.priceSource } : {}),
  };
}

function withOfferLinks(item: PickedItem): PickedItem {
  if (!item.offers?.length) {
    return item;
  }
  const offers: ItemOffer[] = item.offers.map((offer) => {
    const url = itemSearchUrl(offer.storeName, offer);
    return url ? { ...offer, url } : offer;
  });
  return { ...item, offers };
}

const WEEKLY_AD_SEGMENT_LABEL = "Weekly ad, not shelf price";

function weeklyAdSegment(storeName: string, pricing: StorePricingReport | undefined): boolean {
  if (
    pricing?.source === "live" ||
    pricing?.source === "cached_live" ||
    pricing?.source === "partner_feed" ||
    pricing?.source === "mixed" ||
    pricing?.source === "seed" ||
    pricing?.source === "unavailable"
  ) {
    return false;
  }
  if (pricing?.source === "weekly_ad" || pricing?.source === "cached_weekly_ad") {
    return true;
  }
  return mappingForStore(storeName)?.dealsOnly === true;
}

function priceLabelFor(group: StoreGroup, pricing: StorePricingReport | undefined): string {
  if (weeklyAdSegment(group.storeName, pricing)) {
    return WEEKLY_AD_SEGMENT_LABEL;
  }
  if (pricing?.source) {
    return priceSourceLabel(pricing.source);
  }
  const sources = [
    ...new Set(group.items.map((item) => item.priceSource).filter((source): source is PriceSource => Boolean(source))),
  ];
  if (sources.length === 1) {
    if (sources[0] === "weekly_ad") {
      return WEEKLY_AD_SEGMENT_LABEL;
    }
    return priceSourceLabel(sources[0]);
  }
  if (sources.length > 1) {
    return "Mixed prices";
  }
  return "Price";
}

function shopListAction(
  storeName: string,
  items: HandoffItem[],
  detail: string
): StoreHandoffAction {
  const firstUrl = items.find((item) => item.url)?.url;
  return {
    type: "shop_list",
    label: `Open ${storeName} list`,
    status: "ready",
    ...(firstUrl ? { url: firstUrl } : {}),
    detail,
  };
}

function pricingForStore(
  storeName: string,
  reports: StorePricingReport[] | undefined
): StorePricingReport | undefined {
  const key = storeName.trim().toLowerCase();
  return reports?.find((report) => report.storeName.trim().toLowerCase() === key);
}

function krogerAction(
  items: HandoffItem[],
  oauthConfigured: boolean
): StoreHandoffAction {
  const withUpc = items.filter((item) => Boolean(item.upc || item.productId));
  const firstUrl = items.find((item) => item.url)?.url;

  if (oauthConfigured && withUpc.length > 0) {
    return {
      type: "kroger_cart",
      label: "Send to Kroger cart",
      url: KROGER_CART_START_PATH,
      status: "needs_shopper_login",
      ...(firstUrl ? { fallbackUrl: firstUrl } : {}),
      detail:
        "Signs in to Kroger, then adds the items. Starts Kroger shopper login (authorization-code OAuth), then PUT /v1/cart/add. Grocery Gitter reports success only if Kroger returns HTTP 2xx. The client-credentials token used for pricing cannot write a cart.",
    };
  }

  return shopListAction(
    "Kroger",
    items,
    oauthConfigured
      ? "Kroger Cart API needs a product UPC from the live Products API. This checklist has an Open in Kroger link for each item until those IDs are present. Writing the shopper cart requires authorization-code OAuth."
      : "Opens a checklist with an Open in Kroger link for each item. Writing the shopper cart requires authorization-code OAuth (KROGER_REDIRECT_URI), not the client-credentials pricing token."
  );
}

/**
 * Affiliate item ids are numeric. Demo rows omit them. Flipp weekly-ad rows
 * may carry a flyer id, which is not a Walmart item id — those stay on the
 * search handoff even if the flyer id is numeric.
 */
function walmartCartItemId(item: HandoffItem): string | undefined {
  if (item.priceSource === "weekly_ad" || item.priceSource === "seed") {
    return undefined;
  }
  const id = item.productId?.trim() ?? "";
  return /^\d+$/.test(id) ? id : undefined;
}

function formatNameList(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Walmart shows an error modal and sends the shopper home when any item in
 * the link cannot be added. Lines without a numeric item id stay off the
 * link, and the button copy names them.
 */
function skippedWalmartNote(names: string[]): string {
  if (names.length === 0) {
    return "";
  }
  const noun = names.length === 1 ? "item" : "items";
  return ` Skipped ${names.length} ${noun} (${formatNameList(names)}) with no Walmart item id. Walmart shows an error and sends the shopper to the home page if any item in the link cannot be added, so those lines are left off.`;
}

function walmartCartOptions(store: WalmartNearbyStore | undefined): WalmartAddToCartOptions {
  if (!store) {
    return {};
  }
  const storeId = store.fulfillmentStoreId?.trim() || store.storeId.trim();
  const accessPointId = store.accessPointId?.trim();
  return {
    ...(storeId ? { storeId } : {}),
    ...(accessPointId ? { accessPointId } : {}),
  };
}

function walmartAction(
  items: HandoffItem[],
  store?: WalmartNearbyStore
): StoreHandoffAction {
  const firstUrl = items.find((item) => item.url)?.url;
  const searchAction: StoreHandoffAction = shopListAction(
    "Walmart",
    items,
    "Checklist with an Open in Walmart link for each item, not a cart fill. Authenticated Walmart cart APIs need partner access; Grocery Gitter does not invent a cart write."
  );
  if (!firstUrl) {
    searchAction.status = "unavailable";
  }

  const cartLines: WalmartCartLine[] = [];
  const cartItems: HandoffItem[] = [];
  const skippedNames: string[] = [];
  for (const item of items) {
    const itemId = walmartCartItemId(item);
    if (!itemId) {
      skippedNames.push(item.name);
      continue;
    }
    cartItems.push(item);
    cartLines.push({ itemId, quantity: item.quantity });
  }
  if (cartLines.length === 0) {
    return searchAction;
  }

  const url = walmartAddToCartUrl(
    cartLines,
    readWalmartPublisherId(),
    walmartCartOptions(store)
  );
  if (!url) {
    return searchAction;
  }

  const count = itemCountOf(cartItems);
  const publisherId = readWalmartPublisherId();
  const attribution = publisherId
    ? "The link includes your Impact publisher id (WALMART_PUBLISHER_ID) so a qualifying Walmart.com purchase can earn commission."
    : "WALMART_PUBLISHER_ID is unset, so this link is not attributed. Set it after Impact approval to earn commission; the cart link still works without it.";

  return {
    type: "walmart_cart",
    label: "Open in Walmart cart",
    url,
    status: "ready",
    ...(firstUrl ? { fallbackUrl: firstUrl } : {}),
    detail: `Opens a Walmart link with the items in the cart (${count} item${count === 1 ? "" : "s"}). This is a link, not a write to a Walmart account. ${attribution} Grocery Gitter does not call a Walmart cart API and does not report the cart as filled. Prices are walmart.com catalog; the Affiliate search API has no store-price filter.${skippedWalmartNote(skippedNames)}`,
  };
}

function targetAction(storeName: string, items: HandoffItem[]): StoreHandoffAction {
  return shopListAction(
    storeName,
    items,
    "Checklist with an Open in Target link for each item (search, or a product page when the id is a TCIN). Not a cart fill. Target authenticated cart fill needs a partner API; Grocery Gitter does not invent one."
  );
}

function partnerSearchAction(
  storeName: string,
  items: HandoffItem[]
): StoreHandoffAction {
  const mapping = mappingForStore(storeName);
  const key = retailerKey(storeName);
  const club = Boolean(mapping?.club) || key === "costco" || key === "sams_club";
  const weekly =
    Boolean(mapping?.dealsOnly) || items.some((item) => item.priceSource === "weekly_ad");
  const clubNote = club
    ? " Club prices often need a membership; third-party cart-write is not available."
    : key === "whole_foods" || key === "amazon_fresh"
      ? " Amazon Fresh / Whole Foods checkout is not a third-party cart API."
      : " There is no public cart-write API for this banner.";
  const priceNote = weekly ? " Prices are the weekly ad, not a shelf price." : "";

  return shopListAction(
    storeName,
    items,
    `Checklist with item links. Each line has an Open in ${storeName} link. Not a cart fill.${clubNote}${priceNote}`
  );
}

function listOnlyAction(storeName: string): StoreHandoffAction {
  return shopListAction(
    storeName,
    [],
    `${storeName} has prices in the trip, but no verified item link. The checklist is the handoff. Nothing here is a cart fill.`
  );
}

export function buildStoreHandoff(
  group: StoreGroup,
  options: HandoffOptions = {}
): StoreHandoff {
  const itemCount = itemCountOf(group.items);
  const tier = handoffTierFor(group.storeName);
  const items = group.items.map((item) => toHandoffItem(group.storeName, item));
  const pricing = pricingForStore(group.storeName, options.pricingByStore);
  const retailer = canonicalRetailer(group.storeName);

  let action: StoreHandoffAction;
  if (retailer === "kroger") {
    action = krogerAction(items, Boolean(options.krogerCartOAuthConfigured));
  } else if (retailer === "walmart") {
    action = walmartAction(items, options.walmartStore);
  } else if (retailer === "target") {
    action = targetAction(group.storeName, items);
  } else if (tier === "list" || !items.some((item) => item.url)) {
    action = listOnlyAction(group.storeName);
  } else {
    action = partnerSearchAction(group.storeName, items);
  }

  const coupon = publicCouponLink(group.storeName);
  return {
    storeName: group.storeName,
    tier,
    priceLabel: priceLabelFor(group, pricing),
    itemCount,
    subtotal: group.subtotal,
    items,
    action,
    ...(coupon ? { coupon } : {}),
  };
}

function tripCapabilities(options: HandoffOptions): TripCapabilities {
  const publisherId = readWalmartPublisherId();
  const store = options.walmartStore;
  const storeId = store?.fulfillmentStoreId?.trim() || store?.storeId?.trim();
  const accessPointId = store?.accessPointId?.trim();
  return {
    krogerCart: Boolean(options.krogerCartOAuthConfigured),
    ...(publisherId ? { walmartPublisherId: publisherId } : {}),
    ...(storeId ? { walmartStoreId: storeId } : {}),
    ...(accessPointId ? { walmartAccessPointId: accessPointId } : {}),
  };
}

export function enrichOptimizeResult(
  result: OptimizeResult,
  options: HandoffOptions = {}
): EnrichedOptimizeResult {
  const stores = result.stores.map((group) => {
    const pricing = pricingForStore(group.storeName, options.pricingByStore);
    const nearbyStore =
      group.storeName.trim().toLowerCase() === "walmart"
        ? options.walmartStore
        : undefined;
    const linked = {
      ...group,
      items: group.items.map((item) => withOfferLinks(item)),
    };
    return {
      ...linked,
      itemCount: itemCountOf(linked.items),
      handoff: buildStoreHandoff(linked, options),
      ...(pricing ? { pricing } : {}),
      ...(nearbyStore ? { nearbyStore } : {}),
    };
  });

  return {
    ...result,
    stores,
    tripPlan: {
      summary: formatTripSummary(stores),
      storeCount: stores.length,
      itemCount: stores.reduce((sum, store) => sum + store.itemCount, 0),
    },
    capabilities: tripCapabilities(options),
    ...(options.pricingByStore ? { pricingByStore: options.pricingByStore } : {}),
  };
}
