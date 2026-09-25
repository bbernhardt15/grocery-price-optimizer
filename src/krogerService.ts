import type { CatalogProduct } from "./optimizeGroceryList";

const KROGER_API_BASE = "https://api.kroger.com/v1";
const TOKEN_ENDPOINT = `${KROGER_API_BASE}/connect/oauth2/token`;
const LOCATIONS_ENDPOINT = `${KROGER_API_BASE}/locations`;
const PRODUCTS_ENDPOINT = `${KROGER_API_BASE}/products`;

/** Catalog location used when Kroger API credentials are not configured. */
export const DEMO_KROGER_LOCATION_ID = "01400441";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type KrogerLocation = {
  locationId?: string;
};

type LocationsResponse = {
  data?: KrogerLocation[];
};

type KrogerPrice = {
  regular?: number;
  promo?: number;
};

type KrogerImageSize = { size?: string; url?: string };
type KrogerImage = { perspective?: string; sizes?: KrogerImageSize[] };
type KrogerInventory = { stockLevel?: string };

type KrogerProductItem = {
  itemId?: string;
  size?: string;
  price?: KrogerPrice;
  nationalPrice?: KrogerPrice;
  inventory?: KrogerInventory;
};

export class KrogerPricingError extends Error {
  readonly code: "missing_credentials" | "http" | "network";

  readonly status?: number;

  constructor(
    message: string,
    code: "missing_credentials" | "http" | "network" = "http",
    status?: number
  ) {
    super(message);
    this.name = "KrogerPricingError";
    this.code = code;
    this.status = status;
  }
}

type KrogerProduct = {
  productId?: string;
  upc?: string;
  brand?: string;
  description?: string;
  categories?: unknown;
  images?: KrogerImage[];
  items?: KrogerProductItem[];
};

type ProductsResponse = {
  data?: KrogerProduct[];
};

const groceryUnits = ["oz", "lbs", "count", "g", "kg", "ml", "l", "gal"] as const;
type GroceryUnit = (typeof groceryUnits)[number];

function parseKrogerUnit(size?: string): GroceryUnit {
  const value = (size ?? "").toLowerCase();
  if (/\bgal/.test(value)) return "gal";
  if (/\bfl\s*oz|\boz\b/.test(value)) return "oz";
  if (/\blbs?\b|\bpounds?\b/.test(value)) return "lbs";
  if (/\bkg\b/.test(value)) return "kg";
  if (/\bml\b/.test(value)) return "ml";
  if (/\bl\b/.test(value)) return "l";
  if (/\bg\b/.test(value)) return "g";
  return "count";
}

function priceFrom(price?: KrogerPrice): number | null {
  const promo = price?.promo;
  const regular = price?.regular;
  if (typeof promo === "number" && promo > 0) {
    return promo;
  }
  if (typeof regular === "number" && regular >= 0) {
    return regular;
  }
  return null;
}

function pickKrogerPrice(item?: KrogerProductItem): number | null {
  return priceFrom(item?.price) ?? priceFrom(item?.nationalPrice);
}

function pricedItem(product: KrogerProduct): KrogerProductItem | undefined {
  return (product.items ?? []).find((item) => pickKrogerPrice(item) !== null);
}

function categoryNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      names.push(entry.trim());
    } else if (entry && typeof entry === "object" && "name" in entry) {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) {
        names.push(name.trim());
      }
    }
  }
  return names;
}

function krogerImageUrls(images: KrogerImage[] | undefined): string[] {
  const urls: string[] = [];
  for (const image of images ?? []) {
    const sizes = [...(image.sizes ?? [])].sort((a, b) => {
      const rank = (size?: string) =>
        size === "xlarge" ? 4 : size === "large" ? 3 : size === "medium" ? 2 : size === "small" ? 1 : 0;
      return rank(b.size) - rank(a.size);
    });
    const url = sizes.find((size) => size.url?.trim())?.url?.trim();
    if (url) {
      urls.push(url);
    }
  }
  return urls.slice(0, 4);
}

function krogerAvailability(item?: KrogerProductItem): "in_stock" | "out_of_stock" | "unknown" {
  const level = item?.inventory?.stockLevel?.trim().toUpperCase();
  if (!level) {
    return "unknown";
  }
  if (level.includes("OUT")) {
    return "out_of_stock";
  }
  return "in_stock";
}

function toCatalogProduct(
  product: KrogerProduct,
  locationId?: string
): CatalogProduct | null {
  const name = product.description?.trim();
  const item = pricedItem(product) ?? product.items?.[0];
  const price = pickKrogerPrice(item);
  if (!name || price === null) {
    return null;
  }

  const unit = parseKrogerUnit(item?.size);
  const productId = product.productId?.trim();
  const upc = product.upc?.trim() || productId;
  const size = item?.size?.trim();
  const categories = categoryNames(product.categories);
  const imageUrls = krogerImageUrls(product.images);
  const regular = item?.price?.regular ?? item?.nationalPrice?.regular;
  const promo = item?.price?.promo ?? item?.nationalPrice?.promo;
  const onSale = typeof promo === "number" && promo > 0 && (typeof regular !== "number" || promo < regular);
  return {
    name,
    brand: product.brand?.trim() || "Kroger",
    storeName: "Kroger",
    locationId,
    ...(productId ? { productId } : {}),
    ...(upc ? { upc } : {}),
    ...(size ? { size } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    ...(imageUrls.length > 0 ? { imageUrls } : {}),
    ...(onSale ? { onSale: true } : {}),
    availability: krogerAvailability(item),
    price,
    unit,
    normalizedUnit: unit,
  };
}

function readCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.KROGER_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.KROGER_CLIENT_SECRET?.trim() ?? "";

  if (!clientId || !clientSecret) {
    throw new KrogerPricingError(
      "Kroger API credentials are missing. Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET on the server.",
      "missing_credentials"
    );
  }

  return { clientId, clientSecret };
}

function demoLocationId(): string {
  return process.env.KROGER_MOCK_LOCATION_ID?.trim() || DEMO_KROGER_LOCATION_ID;
}

function normalizeZip(zipCode: string): string {
  const zip = zipCode.trim();
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) {
    throw new Error(`Invalid ZIP code: ${zipCode}`);
  }

  return zip.slice(0, 5);
}

/**
 * Client for Kroger's public Locations API (api.kroger.com).
 * Tokens are fetched once via client-credentials and reused until they expire.
 */
export class KrogerService {
  private accessToken: string | null = null;
  private tokenExpiresAtMs = 0;

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAtMs) {
      return this.accessToken;
    }

    const { clientId, clientSecret } = readCredentials();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: process.env.KROGER_SCOPE?.trim() || "product.compact",
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    const payload = (await response.json()) as TokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new KrogerPricingError(
        payload.error_description ||
          payload.error ||
          `Kroger token request failed (${response.status})`,
        "http"
      );
    }

    const lifetimeMs = Math.max((payload.expires_in ?? 1800) - 60, 30) * 1000;
    this.accessToken = payload.access_token;
    this.tokenExpiresAtMs = now + lifetimeMs;
    return this.accessToken;
  }

  /**
   * GET /v1/locations?filter.zipCode.near={zip}&filter.limit=1
   * Returns the locationId of the closest store to `zipCode`.
   * Falls back to the seeded demo location when credentials are missing
   * or the official API rejects the request, so local pricing still works.
   */
  async getClosestStoreLocation(zipCode: string): Promise<string> {
    const zip = normalizeZip(zipCode);
    const clientId = process.env.KROGER_CLIENT_ID?.trim() ?? "";
    const clientSecret = process.env.KROGER_CLIENT_SECRET?.trim() ?? "";
    if (!clientId || !clientSecret) {
      return demoLocationId();
    }

    try {
      const token = await this.getAccessToken();
      const query = new URLSearchParams({
        "filter.zipCode.near": zip,
        "filter.limit": "1",
      });

      const response = await fetch(`${LOCATIONS_ENDPOINT}?${query.toString()}`, {
        method: "GET",
        cache: "no-cache",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Kroger locations request failed (${response.status}) for ZIP ${zip}`
        );
      }

      const payload = (await response.json()) as LocationsResponse;
      const locationId = payload.data?.[0]?.locationId?.trim();
      if (!locationId) {
        throw new Error(`No Kroger store found near ZIP ${zip}`);
      }

      return locationId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `Kroger Locations API unavailable (${message}); using demo store ${demoLocationId()}`
      );
      return demoLocationId();
    }
  }

  private async fetchProductPayload(
    term: string,
    locationId?: string,
    paging?: { start?: number; limit?: number; brand?: string }
  ): Promise<{ products: KrogerProduct[]; status: number }> {
    const token = await this.getAccessToken();
    const limit = Math.min(Math.max(paging?.limit ?? 25, 1), 200);
    const params = new URLSearchParams({
      "filter.term": term,
      "filter.limit": String(limit),
    });
    if (paging?.start && paging.start > 0) {
      params.set("filter.start", String(Math.floor(paging.start)));
    }
    if (paging?.brand?.trim()) {
      params.set("filter.brand", paging.brand.trim());
    }
    if (locationId?.trim()) {
      params.set("filter.locationId", locationId.trim());
    }

    let response: Response;
    try {
      response = await fetch(`${PRODUCTS_ENDPOINT}?${params.toString()}`, {
        method: "GET",
        cache: "no-cache",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new KrogerPricingError(
        `Kroger Products API unavailable (${message})`,
        "network"
      );
    }

    if (!response.ok) {
      throw new KrogerPricingError(
        `Kroger products request failed (${response.status})`,
        "http",
        response.status
      );
    }

    const payload = (await response.json()) as ProductsResponse;
    return { products: payload.data ?? [], status: response.status };
  }

  /**
   * GET /v1/products?filter.term={term}&filter.locationId={id}&filter.limit=25
   * Returns shelf prices for the nearest store when `locationId` is set.
   * If that store returns catalog rows without prices, retries without a
   * location and uses nationalPrice so ordinary items still price.
   */
  async searchProducts(
    term: string,
    locationId?: string
  ): Promise<CatalogProduct[]> {
    const query = term.trim();
    if (!query) {
      return [];
    }

    try {
      const storeId = locationId?.trim() || undefined;
      const rawPage = await this.fetchProductPayload(query, storeId);
      const raw = rawPage.products;
      const priced = raw
        .map((product) => toCatalogProduct(product, storeId))
        .filter((product): product is CatalogProduct => product !== null);

      if (priced.length > 0 || !storeId || raw.length === 0) {
        return priced;
      }

      const national = (await this.fetchProductPayload(query)).products;
      return national
        .map((product) => toCatalogProduct(product, storeId))
        .filter((product): product is CatalogProduct => product !== null);
    } catch (error) {
      if (error instanceof KrogerPricingError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new KrogerPricingError(
        `Kroger Products API unavailable (${message})`,
        "network"
      );
    }
  }

  /**
   * One Products page for catalog ingestion.
   * `filter.limit` is capped at 200 (the maximum Kroger documents for
   * Locations pagination and the figure used by their product examples).
   * `returned` is the raw row count, including rows we cannot price, so
   * the crawler can tell a short page from a full one.
   */
  async searchProductsPage(input: {
    term: string;
    locationId?: string;
    start?: number;
    limit?: number;
    brand?: string;
  }): Promise<{ products: CatalogProduct[]; returned: number }> {
    const term = input.term.trim();
    if (!term) {
      return { products: [], returned: 0 };
    }
    const locationId = input.locationId?.trim() || undefined;
    const page = await this.fetchProductPayload(term, locationId, {
      start: input.start,
      limit: input.limit,
      brand: input.brand,
    });
    const products = page.products
      .map((product) => toCatalogProduct(product, locationId))
      .filter((product): product is CatalogProduct => product !== null);
    return { products, returned: page.products.length };
  }
}

export const krogerService = new KrogerService();
