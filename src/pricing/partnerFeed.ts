import type { CatalogProduct } from "../optimizeGroceryList";
import { isGroceryUnit, parseGroceryUnit } from "./parseGroceryUnit";
import type { PricingContext, StorePricingProvider } from "./types";
import { StorePricingError } from "./types";

/**
 * Grocery Gitter's licensed partner-feed HTTP contract.
 *
 * This is **not** Instacart Connect, Datasembly, or any other vendor's real
 * public API. Those partners do not publish a self-serve grocery price API
 * that this app can call. When Brandon gets credentials, either:
 *
 * 1. Point `*_PARTNER_BASE_URL` at a thin proxy that maps the vendor JSON
 *    onto this contract, or
 * 2. Replace `searchPartnerFeed` with a documented vendor client.
 *
 * Until then, providers stay unconfigured and stores stay off live pricing.
 *
 * ```
 * GET {base}/products?query={term}&zip={zip}&store={storeName}
 * Authorization: Bearer {apiKey}
 * Accept: application/json
 *
 * 200:
 * {
 *   "products": [
 *     {
 *       "name": "string",
 *       "brand": "string",
 *       "price": 2.59,
 *       "productId": "string",
 *       "upc": "string",
 *       "unit": "gal" | "oz" | "lbs" | "count" | ...,
 *       "size": "optional",
 *       "storeName": "optional override"
 *     }
 *   ]
 * }
 * ```
 *
 * Do not scrape authenticated storefronts to implement this.
 */
export const PARTNER_FEED_CONTRACT =
  "GET {base}/products?query=&zip=&store= with Authorization: Bearer <key>. JSON { products: [{ name, brand, price, productId, upc, unit }] }.";

export type PartnerProduct = {
  name?: string;
  brand?: string;
  price?: number;
  productId?: string;
  tcin?: string;
  sku?: string;
  upc?: string;
  gtin?: string;
  unit?: string;
  size?: string;
  storeName?: string;
};

export type PartnerFeedResponse = {
  products?: PartnerProduct[];
  items?: PartnerProduct[];
  data?: PartnerProduct[];
  error?: string;
  message?: string;
};

export type PartnerFeedConfig = {
  baseUrl: string;
  apiKey: string;
};

export type PartnerFeedOptions = {
  storeName: string;
  /** Env prefix without `_BASE_URL` / `_API_KEY`, e.g. `SHELF_FEED`. */
  envPrefix: string;
  setupHint: string;
  /** Banner name sent as `store=` on a multi-retailer feed. */
  storeQueryValue?: string;
};

export function readPartnerFeedConfig(
  envPrefix: string,
  env: NodeJS.ProcessEnv = process.env
): PartnerFeedConfig | null {
  const baseUrl = env[`${envPrefix}_BASE_URL`]?.trim() ?? "";
  const apiKey = env[`${envPrefix}_API_KEY`]?.trim() ?? "";
  if (!baseUrl || !apiKey) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

export function parsePartnerStoreList(value?: string | null): string[] {
  if (!value) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of value.split(",")) {
    const store = part.trim();
    if (!store) {
      continue;
    }
    const key = store.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(store);
  }
  return names;
}

export function toPartnerCatalogProduct(
  item: PartnerProduct,
  storeName: string,
  zipCode?: string
): CatalogProduct | null {
  const name = item.name?.trim();
  const price = item.price;
  if (!name || typeof price !== "number" || price < 0) {
    return null;
  }

  const unit = isGroceryUnit(item.unit)
    ? item.unit
    : parseGroceryUnit(item.size || item.unit);
  const productId = (item.productId || item.tcin || item.sku)?.trim();
  const upc = (item.upc || item.gtin)?.trim();
  const banner = item.storeName?.trim() || storeName;
  const size = item.size?.trim();
  return {
    name,
    brand: item.brand?.trim() || banner,
    storeName: banner,
    ...(productId ? { productId } : {}),
    ...(upc ? { upc } : {}),
    ...(zipCode ? { locationId: zipCode } : {}),
    ...(size ? { size } : {}),
    price,
    unit,
    normalizedUnit: unit,
    priceSource: "live",
  };
}

export async function searchPartnerFeed(
  options: PartnerFeedOptions,
  term: string,
  context: PricingContext = {},
  env: NodeJS.ProcessEnv = process.env
): Promise<CatalogProduct[]> {
  const query = term.trim();
  if (!query) {
    return [];
  }

  const config = readPartnerFeedConfig(options.envPrefix, env);
  if (!config) {
    throw new StorePricingError(
      options.storeName,
      options.setupHint,
      "not_available"
    );
  }

  const params = new URLSearchParams({ query });
  const zip = context.zipCode?.trim().slice(0, 5);
  if (zip) {
    params.set("zip", zip);
  }
  const storeQuery = (options.storeQueryValue || options.storeName).trim();
  if (storeQuery) {
    params.set("store", storeQuery);
  }

  const url = `${config.baseUrl}/products?${params.toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-cache",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StorePricingError(
      options.storeName,
      `${options.storeName} partner feed unavailable (${message})`,
      "network"
    );
  }

  const payload = (await response.json().catch(() => ({}))) as PartnerFeedResponse;
  if (!response.ok) {
    throw new StorePricingError(
      options.storeName,
      payload.message ||
        payload.error ||
        `${options.storeName} partner feed failed (${response.status})`,
      "http"
    );
  }

  const rows = payload.products ?? payload.items ?? payload.data ?? [];
  return rows
    .map((row) => toPartnerCatalogProduct(row, options.storeName, context.zipCode))
    .filter((product): product is CatalogProduct => product !== null);
}

/**
 * Env-gated licensed feed. Unconfigured providers throw `not_available`
 * rather than inventing prices or scraping a storefront.
 */
export class PartnerFeedProvider implements StorePricingProvider {
  readonly feedKind = "partner_feed" as const;
  readonly storeName: string;

  constructor(private readonly options: PartnerFeedOptions) {
    this.storeName = options.storeName;
  }

  isConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return readPartnerFeedConfig(this.options.envPrefix, env) !== null;
  }

  setupHint(): string {
    return this.options.setupHint;
  }

  searchProducts(
    term: string,
    context: PricingContext = {}
  ): Promise<CatalogProduct[]> {
    return searchPartnerFeed(this.options, term, context);
  }
}
