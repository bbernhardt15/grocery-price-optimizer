import type { CatalogProduct } from "../optimizeGroceryList";
import { parseGroceryUnit } from "./parseGroceryUnit";
import type { PricingContext, StorePricingProvider } from "./types";
import { StorePricingError } from "./types";
import {
  readWalmartCredentials,
  WALMART_AFFILIATE_BASE,
  walmartAuthHeaders,
  type WalmartCredentials,
} from "./walmartAuth";

export const WALMART_SETUP_HINT =
  "Walmart live prices use the official Affiliate Marketing API (walmart.io). Set WALMART_CONSUMER_ID and WALMART_PRIVATE_KEY (PEM; newlines as \\n). Optional WALMART_KEY_VERSION (default 1). Optional WALMART_PUBLISHER_ID (Impact publisher id) attributes search and the add-to-cart link after Impact approval; catalog search and the cart link still work without it. Prices are walmart.com catalog, not in-aisle local shelf. GET /stores?zip= only labels the nearest store — the search API has no store-price filter.";

/** Nearest store from the Affiliate Store Locator. Display only. */
export type WalmartNearbyStore = {
  storeId: string;
  name: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
};

/** Store locations change rarely; one lookup per ZIP is enough for a day. */
const WALMART_STORE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Cache an empty locator response for an hour so a blip is not sticky all day. */
const WALMART_STORE_MISS_TTL_MS = 60 * 60 * 1000;

type WalmartItem = {
  itemId?: number | string;
  name?: string;
  brandName?: string;
  brand?: string;
  upc?: string;
  salePrice?: number;
  msrp?: number;
  size?: string;
  productUrl?: string;
  thumbnailImage?: string;
  mediumImage?: string;
  largeImage?: string;
  categoryPath?: string;
  categoryNode?: string;
  stock?: string;
};

type WalmartSearchResponse = {
  items?: WalmartItem[];
  error?: string;
  message?: string;
  errors?: Array<{ message?: string; description?: string }>;
};

type WalmartStore = {
  storeId?: number | string;
  no?: number | string;
  name?: string;
  streetAddress?: string;
  city?: string;
  stateProvCode?: string;
  zip?: string | number;
};

type StoreCacheEntry = {
  expiresAt: number;
  store: WalmartNearbyStore | null;
};

function priceOf(item: WalmartItem): number | null {
  if (typeof item.salePrice === "number" && item.salePrice >= 0) {
    return item.salePrice;
  }
  if (typeof item.msrp === "number" && item.msrp >= 0) {
    return item.msrp;
  }
  return null;
}

function toCatalogProduct(item: WalmartItem): CatalogProduct | null {
  const name = item.name?.trim();
  const price = priceOf(item);
  if (!name || price === null) {
    return null;
  }

  const unit = parseGroceryUnit(item.size);
  const productId = item.itemId != null ? String(item.itemId).trim() : "";
  const upc = item.upc?.trim();
  const size = item.size?.trim();
  const imageUrls = [item.largeImage, item.mediumImage, item.thumbnailImage]
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url));
  const categories = [item.categoryPath, item.categoryNode]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const onSale =
    typeof item.msrp === "number" &&
    item.msrp > price &&
    typeof item.salePrice === "number";
  const stock = item.stock?.trim().toLowerCase();
  const availability = !stock
    ? undefined
    : stock.includes("not") || stock.includes("out")
      ? ("out_of_stock" as const)
      : ("in_stock" as const);
  return {
    name,
    brand: (item.brandName || item.brand || "Walmart").trim() || "Walmart",
    storeName: "Walmart",
    ...(productId ? { productId } : {}),
    ...(upc ? { upc } : {}),
    ...(size ? { size } : {}),
    ...(imageUrls.length > 0 ? { imageUrls: [...new Set(imageUrls)].slice(0, 4) } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    ...(onSale ? { onSale: true } : {}),
    ...(availability ? { availability } : {}),
    price,
    unit,
    normalizedUnit: unit,
    priceSource: "live",
  };
}

function errorMessage(payload: WalmartSearchResponse, status: number): string {
  const nested = payload.errors
    ?.map((entry) => entry.message || entry.description)
    .filter((value): value is string => Boolean(value))
    .join("; ");
  return (
    payload.message ||
    payload.error ||
    nested ||
    `Walmart Affiliate API failed (${status})`
  );
}

function storesFromPayload(payload: unknown): WalmartStore[] {
  if (Array.isArray(payload)) {
    return payload as WalmartStore[];
  }
  if (payload && typeof payload === "object") {
    const record = payload as { stores?: unknown; data?: unknown };
    if (Array.isArray(record.stores)) {
      return record.stores as WalmartStore[];
    }
    if (Array.isArray(record.data)) {
      return record.data as WalmartStore[];
    }
  }
  return [];
}

function toNearbyStore(store: WalmartStore): WalmartNearbyStore | undefined {
  const id = store.no ?? store.storeId;
  const storeId = id != null ? String(id).trim() : "";
  if (!storeId) {
    return undefined;
  }
  const name = store.name?.trim() || `Walmart #${storeId}`;
  const zip = store.zip != null ? String(store.zip).trim() : "";
  return {
    storeId,
    name,
    streetAddress: store.streetAddress?.trim() ?? "",
    city: store.city?.trim() ?? "",
    state: store.stateProvCode?.trim() ?? "",
    zip,
  };
}

function zip5(zipCode: string): string | undefined {
  const zip = zipCode.trim().slice(0, 5);
  return /^\d{5}$/.test(zip) ? zip : undefined;
}

export class WalmartPricingProvider implements StorePricingProvider {
  readonly storeName = "Walmart";
  private storeCache = new Map<string, StoreCacheEntry>();
  private storeInflight = new Map<string, Promise<WalmartNearbyStore | undefined>>();

  isConfigured(): boolean {
    return readWalmartCredentials() !== null;
  }

  setupHint(): string {
    return WALMART_SETUP_HINT;
  }

  private credentialsOrThrow(): WalmartCredentials {
    const credentials = readWalmartCredentials();
    if (!credentials) {
      throw new StorePricingError(
        "Walmart",
        WALMART_SETUP_HINT,
        "missing_credentials"
      );
    }
    return credentials;
  }

  private async affiliateGet(
    pathAndQuery: string,
    credentials: WalmartCredentials
  ): Promise<Response> {
    const url = `${WALMART_AFFILIATE_BASE}${pathAndQuery}`;
    try {
      return await fetch(url, {
        method: "GET",
        cache: "no-cache",
        headers: walmartAuthHeaders(credentials),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new StorePricingError(
        "Walmart",
        `Walmart Affiliate API unavailable (${message})`,
        "network"
      );
    }
  }

  /**
   * GET /stores?zip= — Store Locator.
   * Docs: https://walmart.io/apidocs/affiliates/stores
   * (`lat`, `lon`, or `zip`). The first result is the nearest store.
   *
   * Store-scoped pricing is not supported. Affiliate `/search` and `/items`
   * accept publisherId, query, category, and response group — not a store id
   * — so salePrice stays the walmart.com catalog price. This lookup is only
   * used to label the nearest store on the trip plan.
   */
  async getNearestStore(zipCode: string): Promise<WalmartNearbyStore | undefined> {
    const zip = zip5(zipCode);
    if (!zip) {
      return undefined;
    }

    const cached = this.storeCache.get(zip);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.store ?? undefined;
    }

    const inflight = this.storeInflight.get(zip);
    if (inflight) {
      return inflight;
    }

    const request = this.fetchNearestStore(zip).finally(() => {
      this.storeInflight.delete(zip);
    });
    this.storeInflight.set(zip, request);
    return request;
  }

  /** @deprecated Prefer getNearestStore. Kept so callers can read the id alone. */
  async getNearestStoreId(zipCode: string): Promise<string | undefined> {
    const store = await this.getNearestStore(zipCode);
    return store?.storeId;
  }

  private async fetchNearestStore(
    zip: string
  ): Promise<WalmartNearbyStore | undefined> {
    const credentials = this.credentialsOrThrow();
    const response = await this.affiliateGet(
      `/stores?zip=${encodeURIComponent(zip)}`,
      credentials
    );
    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const store = storesFromPayload(payload)
      .map(toNearbyStore)
      .find((entry): entry is WalmartNearbyStore => Boolean(entry));
    this.storeCache.set(zip, {
      expiresAt: Date.now() + (store ? WALMART_STORE_CACHE_TTL_MS : WALMART_STORE_MISS_TTL_MS),
      store: store ?? null,
    });
    return store;
  }

  /**
   * Signed GET against the Affiliate product host. Path must start with `/`
   * and already include the query string (`/taxonomy`, `/paginated/items?…`).
   */
  async getJson(pathAndQuery: string): Promise<unknown> {
    const credentials = this.credentialsOrThrow();
    const response = await this.affiliateGet(pathAndQuery, credentials);
    const payload = (await response.json().catch(() => ({}))) as WalmartSearchResponse;
    if (!response.ok) {
      throw new StorePricingError("Walmart", errorMessage(payload, response.status), "http");
    }
    return payload;
  }

  async searchProducts(
    term: string,
    context: PricingContext = {}
  ): Promise<CatalogProduct[]> {
    const query = term.trim();
    if (!query) {
      return [];
    }

    const credentials = this.credentialsOrThrow();
    // No store id: Affiliate /search has no store-price or availability filter.
    const params = new URLSearchParams({
      query,
      numItems: "25",
      responseGroup: "full",
    });
    if (credentials.publisherId) {
      params.set("publisherId", credentials.publisherId);
    }

    const response = await this.affiliateGet(
      `/search?${params.toString()}`,
      credentials
    );
    const payload = (await response.json().catch(() => ({}))) as WalmartSearchResponse;

    if (!response.ok) {
      throw new StorePricingError(
        "Walmart",
        errorMessage(payload, response.status),
        "http"
      );
    }

    const items = payload.items ?? [];
    const products = items
      .map(toCatalogProduct)
      .filter((product): product is CatalogProduct => product !== null);

    if (context.zipCode) {
      const store = await this.getNearestStore(context.zipCode).catch(
        () => undefined
      );
      if (store) {
        return products.map((product) => ({
          ...product,
          locationId: store.storeId,
        }));
      }
    }

    return products;
  }
}

export const walmartPricingProvider = new WalmartPricingProvider();
