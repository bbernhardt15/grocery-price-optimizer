import type { OptimizeResult, PickedItem, PriceSource, StoreGroup } from "./optimizeGroceryList";
import {
  readWalmartPublisherId,
  walmartAddToCartUrl,
} from "./pricing/walmartCartLink";
import type { WalmartNearbyStore } from "./pricing/walmartProvider";
import type { StorePricingReport } from "./pricing/types";

export type HandoffActionType =
  | "kroger_cart"
  | "walmart_cart"
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
  itemCount: number;
  subtotal: number;
  items: HandoffItem[];
  action: StoreHandoffAction;
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
};

export type HandoffOptions = {
  /**
   * True only when KROGER_REDIRECT_URI (and client id/secret) are set so the
   * authorization-code + Cart API path can be offered. Client-credentials
   * used for Products/Locations are not sufficient.
   */
  krogerCartOAuthConfigured?: boolean;
  pricingByStore?: StorePricingReport[];
  /** Nearest Walmart for this request's ZIP. Display only; prices stay catalog. */
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

function identifierOf(item: Pick<PickedItem, "productId" | "upc" | "name">): string {
  return (item.upc || item.productId || item.name).trim();
}

export function krogerSearchUrl(
  item: Pick<PickedItem, "productId" | "upc" | "name">
): string {
  const query = new URLSearchParams({ query: identifierOf(item) });
  return `${KROGER_SEARCH}?${query.toString()}`;
}

export function walmartSearchUrl(
  item: Pick<PickedItem, "productId" | "upc" | "name">
): string {
  const productId = item.productId?.trim();
  if (productId) {
    return `https://www.walmart.com/ip/${encodeURIComponent(productId)}`;
  }
  const query = new URLSearchParams({ q: (item.upc || item.name).trim() });
  return `${WALMART_SEARCH}?${query.toString()}`;
}

export function targetSearchUrl(
  item: Pick<PickedItem, "productId" | "upc" | "name">
): string {
  const productId = item.productId?.trim();
  if (productId) {
    return `https://www.target.com/p/-/A-${encodeURIComponent(productId)}`;
  }
  const query = new URLSearchParams({
    searchTerm: (item.upc || item.name).trim(),
  });
  return `${TARGET_SEARCH}?${query.toString()}`;
}

function searchQuery(item: Pick<PickedItem, "productId" | "upc" | "name">): string {
  return (item.upc || item.productId || item.name).trim();
}

/** Public storefront search — not a cart fill. */
export function partnerSearchUrl(
  storeName: string,
  item: Pick<PickedItem, "productId" | "upc" | "name">
): string | undefined {
  const q = encodeURIComponent(searchQuery(item));
  switch (retailerKey(storeName)) {
    case "publix":
      return `https://www.publix.com/search?searchTerm=${q}`;
    case "heb":
      return `https://www.heb.com/search/?q=${q}`;
    case "meijer":
      return `https://www.meijer.com/shopping/search.html?query=${q}`;
    case "safeway":
      return `https://www.safeway.com/shop/search-results.html?q=${q}`;
    case "albertsons":
      return `https://www.albertsons.com/shop/search-results.html?q=${q}`;
    case "food_lion":
      return `https://www.foodlion.com/shop/search-results.html?q=${q}`;
    case "giant":
      return `https://giantfood.com/shop/search-results.html?q=${q}`;
    case "stop_and_shop":
      return `https://stopandshop.com/shop/search-results.html?q=${q}`;
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

function itemSearchUrl(storeName: string, item: PickedItem): string | undefined {
  switch (canonicalRetailer(storeName)) {
    case "kroger":
      return krogerSearchUrl(item);
    case "walmart":
      return walmartSearchUrl(item);
    case "target":
      return targetSearchUrl(item);
    default:
      return partnerSearchUrl(storeName, item);
  }
}

function toHandoffItem(storeName: string, item: PickedItem): HandoffItem {
  const url = itemSearchUrl(storeName, item);
  return {
    name: item.name,
    brand: item.brand,
    quantity: item.quantity,
    price: item.price,
    ...(item.productId ? { productId: item.productId } : {}),
    ...(item.upc ? { upc: item.upc } : {}),
    ...(item.locationId ? { locationId: item.locationId } : {}),
    ...(url ? { url } : {}),
    ...(item.priceSource ? { priceSource: item.priceSource } : {}),
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
      label: "Add to Kroger cart",
      url: KROGER_CART_START_PATH,
      status: "needs_shopper_login",
      ...(firstUrl ? { fallbackUrl: firstUrl } : {}),
      detail:
        "Starts Kroger shopper login (authorization-code OAuth), then PUT /v1/cart/add. Grocery Gitter reports success only if Kroger returns HTTP 2xx. The client-credentials token used for pricing cannot write a cart.",
    };
  }

  return {
    type: "search_deeplink",
    label: "Open at Kroger",
    url: firstUrl,
    status: firstUrl ? "ready" : "unavailable",
    detail: oauthConfigured
      ? "Kroger Cart API needs a product UPC from the live Products API. This list only has search links until those IDs are present."
      : "Opens Kroger search. Writing the shopper cart requires authorization-code OAuth (KROGER_REDIRECT_URI), not the client-credentials pricing token.",
  };
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

function walmartAction(items: HandoffItem[]): StoreHandoffAction {
  const firstUrl = items.find((item) => item.url)?.url;
  const searchAction: StoreHandoffAction = {
    type: "search_deeplink",
    label: "Search at Walmart",
    url: firstUrl,
    status: firstUrl ? "ready" : "unavailable",
    detail:
      "Search deep link, not a cart fill. Authenticated Walmart cart APIs need partner access; Grocery Gitter does not invent a cart write.",
  };

  const itemIds = items.map(walmartCartItemId);
  if (items.length === 0 || itemIds.some((id) => !id)) {
    return searchAction;
  }

  const url = walmartAddToCartUrl(
    items.map((item, index) => ({
      itemId: itemIds[index] as string,
      quantity: item.quantity,
    })),
    readWalmartPublisherId()
  );
  if (!url) {
    return searchAction;
  }

  const count = itemCountOf(items);
  const publisherId = readWalmartPublisherId();
  const attribution = publisherId
    ? "The link includes your Impact publisher id (WALMART_PUBLISHER_ID) so a qualifying Walmart.com purchase can earn commission."
    : "WALMART_PUBLISHER_ID is unset, so this link is not attributed. Set it after Impact approval to earn commission; the cart link still works without it.";

  return {
    type: "walmart_cart",
    label: `Add ${count} item${count === 1 ? "" : "s"} to Walmart cart`,
    url,
    status: "ready",
    ...(firstUrl ? { fallbackUrl: firstUrl } : {}),
    detail: `Opens walmart.com with these item ids and quantities in the cart. ${attribution} Grocery Gitter does not call a Walmart cart API and does not report the cart as filled. Prices are walmart.com catalog; the Affiliate search API has no store-price filter.`,
  };
}

function targetAction(items: HandoffItem[]): StoreHandoffAction {
  const firstUrl = items.find((item) => item.url)?.url;
  return {
    type: "search_deeplink",
    label: "Search at Target",
    url: firstUrl,
    status: firstUrl ? "ready" : "unavailable",
    detail:
      "Search deep link, not a cart fill. Target authenticated cart fill needs a partner API; Grocery Gitter does not invent one.",
  };
}

function comingSoonAction(storeName: string): StoreHandoffAction {
  return {
    type: "coming_soon",
    label: "Coming soon",
    status: "coming_soon",
    detail: `${storeName} online checkout is not wired yet. Authenticated cart fill needs a retailer partner API (see the Phase 3 table in docs/PRODUCT_ROADMAP.md).`,
  };
}

function partnerSearchAction(
  storeName: string,
  items: HandoffItem[]
): StoreHandoffAction {
  const firstUrl = items.find((item) => item.url)?.url;
  const key = retailerKey(storeName);
  const club =
    key === "costco" || key === "sams_club"
      ? " Club prices often need a membership; third-party cart-write is not available."
      : key === "whole_foods" || key === "amazon_fresh"
        ? " Amazon Fresh / Whole Foods checkout is not a third-party cart API."
        : " There is no public cart-write API for this banner.";

  return {
    type: "search_deeplink",
    label: `Search at ${storeName}`,
    url: firstUrl,
    status: firstUrl ? "ready" : "unavailable",
    detail: `Search deep link, not a cart fill.${club}`,
  };
}

export function buildStoreHandoff(
  group: StoreGroup,
  options: HandoffOptions = {}
): StoreHandoff {
  const itemCount = itemCountOf(group.items);
  const items = group.items.map((item) => toHandoffItem(group.storeName, item));
  const retailer = canonicalRetailer(group.storeName);

  let action: StoreHandoffAction;
  if (retailer === "kroger") {
    action = krogerAction(items, Boolean(options.krogerCartOAuthConfigured));
  } else if (retailer === "walmart") {
    action = walmartAction(items);
  } else if (retailer === "target") {
    action = targetAction(items);
  } else if (retailer === "aldi") {
    action = comingSoonAction(group.storeName);
  } else if (items.some((item) => item.url)) {
    action = partnerSearchAction(group.storeName, items);
  } else {
    action = comingSoonAction(group.storeName);
  }

  return {
    storeName: group.storeName,
    itemCount,
    subtotal: group.subtotal,
    items,
    action,
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
    return {
      ...group,
      itemCount: itemCountOf(group.items),
      handoff: buildStoreHandoff(group, options),
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
    ...(options.pricingByStore ? { pricingByStore: options.pricingByStore } : {}),
  };
}
