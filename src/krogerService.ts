import { krogerProductIdForLookup } from "./catalog/normalize";
import { krogerStartParam } from "./ingest/krogerTerms";
import { readKrogerStore, rememberKrogerStore } from "./krogerLocationCache";
import { buildKrogerSearchTerm, shorterKrogerSearchTerm } from "./krogerSearchTerm";
import type { CatalogProduct } from "./optimizeGroceryList";
import { krogerSale } from "./pricing/saleFacts";

const KROGER_API_BASE = "https://api.kroger.com/v1";
const TOKEN_ENDPOINT = `${KROGER_API_BASE}/connect/oauth2/token`;
const LOCATIONS_ENDPOINT = `${KROGER_API_BASE}/locations`;
const PRODUCTS_ENDPOINT = `${KROGER_API_BASE}/products`;

/** Catalog location used when Kroger API credentials are not configured. */
export const DEMO_KROGER_LOCATION_ID = "01400441";

export type KrogerLocationSource = "live" | "cached" | "demo";

export type KrogerLocationResult = {
  locationId: string;
  source: KrogerLocationSource;
  zip: string;
  /** True when a configured lookup failed and the id is a fallback. */
  lookupFailed: boolean;
};

/**
 * Plain line for the plan when prices are not from the ZIP's live store.
 * Empty when the lookup succeeded or Kroger is not configured.
 */
export function krogerStoreNote(result: KrogerLocationResult | null | undefined): string {
  if (!result?.lookupFailed || result.source === "live") return "";
  if (result.source === "cached") {
    return `Prices are from the last Kroger store we saved for ZIP ${result.zip}, not a fresh store lookup.`;
  }
  return `Prices are from a sample Kroger store, not the store for ZIP ${result.zip}. Kroger's store list didn't answer.`;
}

/**
 * Locations and Products use the client-credentials product scope.
 * A cart scope (`cart.basic:write`) on KROGER_SCOPE is for shopper login, not
 * this token. Sending it here makes Locations answer 403.
 */
function productScope(): string {
  const configured = process.env.KROGER_SCOPE?.trim() || "";
  if (!configured || /\bcart\b|:write|profile\./i.test(configured)) {
    return "product.compact";
  }
  return configured;
}

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

  /** Response body from a failed HTTP call, trimmed. No Authorization header. */
  readonly body?: string;

  constructor(
    message: string,
    code: "missing_credentials" | "http" | "network" = "http",
    status?: number,
    body?: string
  ) {
    super(message);
    this.name = "KrogerPricingError";
    this.code = code;
    this.status = status;
    this.body = body;
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
  const ranked = [...(images ?? [])].sort((a, b) => perspectiveRank(a.perspective) - perspectiveRank(b.perspective));
  const urls: string[] = [];
  for (const image of ranked) {
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

function perspectiveRank(perspective?: string): number {
  const value = (perspective || "").toLowerCase();
  if (value.includes("front")) return 0;
  if (value.includes("nutri") || value.includes("ingredient") || value.includes("drug") || value.includes("barcode")) return 4;
  if (value.includes("back")) return 3;
  return 1;
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
  const sale = krogerSale(price, regular, promo);
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
    ...(sale ?? {}),
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
  lastLocationResult: KrogerLocationResult | null = null;

  async getAccessToken(force = false): Promise<string> {
    const now = Date.now();
    if (!force && this.accessToken && now < this.tokenExpiresAtMs) {
      return this.accessToken;
    }
    this.accessToken = null;
    this.tokenExpiresAtMs = 0;

    const { clientId, clientSecret } = readCredentials();
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: productScope(),
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
   * Throws when credentials are missing or the API rejects the ZIP.
   * A 401/403 drops the cached token and retries once. Shopper pricing then
   * uses the last good store for that ZIP, and only then the demo location.
   */
  private async lookupClosestStoreLocation(zipCode: string, attempt = 0): Promise<string> {
    const zip = normalizeZip(zipCode);
    const clientId = process.env.KROGER_CLIENT_ID?.trim() ?? "";
    const clientSecret = process.env.KROGER_CLIENT_SECRET?.trim() ?? "";
    if (!clientId || !clientSecret) {
      throw new KrogerPricingError(
        "Kroger API credentials are missing. Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET on the server.",
        "missing_credentials"
      );
    }

    const token = await this.getAccessToken(attempt > 0);
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
      if ((response.status === 401 || response.status === 403) && attempt === 0) {
        console.warn(
          `Kroger Locations API ${response.status} for ZIP ${zip} with scope ${productScope()}; refreshing the client-credentials token and retrying once`
        );
        this.accessToken = null;
        this.tokenExpiresAtMs = 0;
        return this.lookupClosestStoreLocation(zip, attempt + 1);
      }
      throw new KrogerPricingError(
        `Kroger locations request failed (${response.status}) for ZIP ${zip}`,
        "http",
        response.status
      );
    }

    const payload = (await response.json()) as LocationsResponse;
    const locationId = payload.data?.[0]?.locationId?.trim();
    if (!locationId) {
      throw new Error(`No Kroger store found near ZIP ${zip}`);
    }
    await rememberKrogerStore(zip, locationId);
    return locationId;
  }

  /**
   * Closest store for shopper pricing.
   * Live id, then the last good id for this ZIP (kept for days), then the demo store.
   */
  async resolveClosestStore(zipCode: string): Promise<KrogerLocationResult> {
    const zip = normalizeZip(zipCode);
    try {
      const locationId = await this.lookupClosestStoreLocation(zip);
      const result: KrogerLocationResult = { locationId, source: "live", zip, lookupFailed: false };
      this.lastLocationResult = result;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Invalid ZIP code/.test(message)) {
        throw error;
      }
      const unconfigured = error instanceof KrogerPricingError && error.code === "missing_credentials";
      if (!unconfigured) {
        const cached = await readKrogerStore(zip);
        const demo = demoLocationId();
        if (cached && cached !== demo) {
          console.warn(
            `Kroger Locations API unavailable (${message}); using last store ${cached} for ZIP ${zip}`
          );
          const result: KrogerLocationResult = { locationId: cached, source: "cached", zip, lookupFailed: true };
          this.lastLocationResult = result;
          return result;
        }
        console.warn(
          `Kroger Locations API unavailable (${message}); using demo store ${demo} for ZIP ${zip}`
        );
        const result: KrogerLocationResult = { locationId: demo, source: "demo", zip, lookupFailed: true };
        this.lastLocationResult = result;
        return result;
      }
      const result: KrogerLocationResult = {
        locationId: demoLocationId(),
        source: "demo",
        zip,
        lookupFailed: false,
      };
      this.lastLocationResult = result;
      return result;
    }
  }

  /**
   * Closest store for shopper pricing. Falls back to the last known store for
   * the ZIP, then the seeded demo location, when the official API rejects the request.
   */
  async getClosestStoreLocation(zipCode: string): Promise<string> {
    const resolved = await this.resolveClosestStore(zipCode);
    return resolved.locationId;
  }

  /**
   * Closest store for catalog ingest. Returns null when the lookup fails.
   * Never substitutes the demo location id, which the Products API rejects.
   */
  async getClosestStoreLocationStrict(zipCode: string): Promise<string | null> {
    try {
      return await this.lookupClosestStoreLocation(zipCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Invalid ZIP code/.test(message)) {
        throw error;
      }
      return null;
    }
  }

  private async fetchProductPayload(
    term: string,
    locationId?: string,
    paging?: { start?: number; limit?: number; brand?: string; productId?: string }
  ): Promise<{ products: KrogerProduct[]; status: number }> {
    const token = await this.getAccessToken();
    const limit = Math.min(Math.max(paging?.limit ?? 25, 1), 200);
    const params = new URLSearchParams({
      "filter.limit": String(limit),
    });
    const productId = paging?.productId?.trim();
    if (productId) {
      params.set("filter.productId", productId);
    } else {
      params.set("filter.term", term);
    }
    const startParam = krogerStartParam(paging?.start);
    if (startParam.action === "too-high") {
      throw new KrogerPricingError(
        `Kroger filter.start ${Math.floor(paging?.start ?? 0)} is above 250 and was not sent`,
        "http",
        400
      );
    }
    if (startParam.action === "send") {
      params.set("filter.start", String(startParam.value));
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
      const body = (await response.text()).replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500);
      throw new KrogerPricingError(
        `Kroger products request failed (${response.status})`,
        "http",
        response.status,
        body
      );
    }

    const payload = (await response.json()) as ProductsResponse;
    return { products: payload.data ?? [], status: response.status };
  }

  private async searchCleanTerm(query: string, storeId?: string): Promise<CatalogProduct[]> {
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
  }

  /**
   * GET /v1/products?filter.term={term}&filter.locationId={id}&filter.limit=25
   * A Kroger UPC is looked up as the 13-digit product id first.
   * The term is brand plus the core name. A 400 retries once with a shorter term.
   * If that store returns catalog rows without prices, retries without a
   * location and uses nationalPrice so ordinary items still price.
   */
  async searchProducts(
    term: string,
    locationId?: string,
    lookup?: { upc?: string }
  ): Promise<CatalogProduct[]> {
    const storeId = locationId?.trim() || undefined;
    const productId = krogerProductIdForLookup(lookup?.upc);
    if (productId) {
      try {
        const byId = await this.productsById(productId, storeId);
        if (byId.products.length > 0) {
          return byId.products;
        }
      } catch (error) {
        if (error instanceof KrogerPricingError && (error.status === 401 || error.status === 403)) {
          throw error;
        }
      }
    }

    const query = buildKrogerSearchTerm(term);
    if (!query) {
      return [];
    }

    try {
      return await this.searchCleanTerm(query, storeId);
    } catch (error) {
      if (error instanceof KrogerPricingError && error.status === 400) {
        const shorter = shorterKrogerSearchTerm(term, query);
        if (shorter) {
          return await this.searchCleanTerm(shorter, storeId);
        }
      }
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

  /**
   * GET /v1/products?filter.productId={id}
   * Kroger's id is the 13-digit UPC body (no check digit). One id per call.
   * Shopper search does not use this. Ingest charges it on the Kroger budget.
   */
  async productsById(
    productId: string,
    locationId?: string
  ): Promise<{ products: CatalogProduct[]; returned: number }> {
    const id = krogerProductIdForLookup(productId) ?? "";
    if (!/^\d{13}$/.test(id)) {
      return { products: [], returned: 0 };
    }
    const storeId = locationId?.trim() || undefined;
    const page = await this.fetchProductPayload("", storeId, { productId: id, limit: 5 });
    const products = page.products
      .map((product) => toCatalogProduct(product, storeId))
      .filter((product): product is CatalogProduct => product !== null);
    return { products, returned: page.products.length };
  }
}

export const krogerService = new KrogerService();
