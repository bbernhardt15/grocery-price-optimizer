import type { OptimizeResult, PickedItem, StoreGroup } from "./optimizeGroceryList";

export type HandoffActionType = "kroger_cart" | "search_deeplink" | "coming_soon";

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
};

export type StoreHandoffAction = {
  type: HandoffActionType;
  label: string;
  url?: string;
  status: HandoffActionStatus;
  /** Honest explanation of what the button does and what still needs retailer OAuth. */
  detail?: string;
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
};

export type EnrichedOptimizeResult = OptimizeResult & {
  stores: EnrichedStoreGroup[];
  tripPlan: TripPlan;
};

export type HandoffOptions = {
  /**
   * True only when KROGER_REDIRECT_URI (and client id/secret) are set so the
   * authorization-code + Cart API path can be offered. Client-credentials
   * used for Products/Locations are not sufficient.
   */
  krogerCartOAuthConfigured?: boolean;
};

const KROGER_SEARCH = "https://www.kroger.com/search";
const WALMART_SEARCH = "https://www.walmart.com/search";
const TARGET_SEARCH = "https://www.target.com/s";
export const KROGER_CART_START_PATH = "/api/kroger/cart/start";

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

function canonicalRetailer(
  storeName: string
): "kroger" | "walmart" | "target" | "aldi" | "other" {
  const name = storeName.trim().toLowerCase();
  if (name === "kroger") return "kroger";
  if (name === "walmart") return "walmart";
  if (name === "target") return "target";
  if (name === "aldi") return "aldi";
  return "other";
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

export function walmartSearchUrl(item: Pick<PickedItem, "name">): string {
  const query = new URLSearchParams({ q: item.name.trim() });
  return `${WALMART_SEARCH}?${query.toString()}`;
}

export function targetSearchUrl(item: Pick<PickedItem, "name">): string {
  const query = new URLSearchParams({ searchTerm: item.name.trim() });
  return `${TARGET_SEARCH}?${query.toString()}`;
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
      return undefined;
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
  };
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
      detail:
        "Starts Kroger authorization-code OAuth (cart.basic:write) so the shopper can log in, then PUT /v1/cart/add. Client-credentials used for pricing cannot write a cart. Items without a UPC still use Open at Kroger search links.",
    };
  }

  return {
    type: "search_deeplink",
    label: "Open at Kroger",
    url: firstUrl,
    status: firstUrl ? "ready" : "unavailable",
    detail: oauthConfigured
      ? "Kroger Cart API needs a product UPC from the live Products API. This list only has search links until those IDs are present."
      : "Opens Kroger search for these items. Writing the shopper cart requires authorization-code OAuth (KROGER_REDIRECT_URI + cart.basic:write), not the existing client-credentials token.",
  };
}

function walmartAction(items: HandoffItem[]): StoreHandoffAction {
  const firstUrl = items.find((item) => item.url)?.url;
  return {
    type: "search_deeplink",
    label: "Search at Walmart",
    url: firstUrl,
    status: firstUrl ? "ready" : "unavailable",
    detail:
      "Public Walmart cart-write APIs are typically closed or require shopper/partner OAuth. This is a search deep link, not a cart fill.",
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
      "Target does not expose a public cart-write API for this app. This is a search deep link, not a cart fill.",
  };
}

function comingSoonAction(storeName: string): StoreHandoffAction {
  return {
    type: "coming_soon",
    label: "Coming soon",
    status: "coming_soon",
    detail: `${storeName} online checkout is not wired yet. Phase 3 will add authenticated cart fill only where a retailer API allows it.`,
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
  const stores = result.stores.map((group) => ({
    ...group,
    itemCount: itemCountOf(group.items),
    handoff: buildStoreHandoff(group, options),
  }));

  return {
    ...result,
    stores,
    tripPlan: {
      summary: formatTripSummary(stores),
      storeCount: stores.length,
      itemCount: stores.reduce((sum, store) => sum + store.itemCount, 0),
    },
  };
}
