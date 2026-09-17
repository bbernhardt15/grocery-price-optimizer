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
  "Walmart live prices use the official Affiliate Marketing API (walmart.io). Set WALMART_CONSUMER_ID, WALMART_PRIVATE_KEY (PEM; newlines as \\n), and WALMART_PUBLISHER_ID (Impact publisher id). Optional WALMART_KEY_VERSION (default 1). Prices are walmart.com catalog, not in-aisle local shelf.";

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
};

type WalmartStoresResponse = {
  stores?: WalmartStore[];
  data?: WalmartStore[];
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
  return {
    name,
    brand: (item.brandName || item.brand || "Walmart").trim() || "Walmart",
    storeName: "Walmart",
    ...(productId ? { productId } : {}),
    ...(upc ? { upc } : {}),
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

export class WalmartPricingProvider implements StorePricingProvider {
  readonly storeName = "Walmart";
  private nearestStoreId: string | undefined;

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
   * GET /stores?zip= — nearest store id for display only. Search prices are
   * still walmart.com catalog (the Affiliate search API has no store filter).
   */
  async getNearestStoreId(zipCode: string): Promise<string | undefined> {
    if (this.nearestStoreId) {
      return this.nearestStoreId;
    }

    const zip = zipCode.trim().slice(0, 5);
    if (!/^\d{5}$/.test(zip)) {
      return undefined;
    }

    const credentials = this.credentialsOrThrow();
    const response = await this.affiliateGet(
      `/stores?zip=${encodeURIComponent(zip)}`,
      credentials
    );
    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as WalmartStoresResponse;
    const stores = payload.stores ?? payload.data ?? [];
    const id = stores[0]?.storeId ?? stores[0]?.no;
    this.nearestStoreId = id != null ? String(id) : undefined;
    return this.nearestStoreId;
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
      const storeId = await this.getNearestStoreId(context.zipCode).catch(
        () => undefined
      );
      if (storeId) {
        return products.map((product) => ({ ...product, locationId: storeId }));
      }
    }

    return products;
  }
}

export const walmartPricingProvider = new WalmartPricingProvider();
