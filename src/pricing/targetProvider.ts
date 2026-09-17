import type { CatalogProduct } from "../optimizeGroceryList";
import { isGroceryUnit, parseGroceryUnit } from "./parseGroceryUnit";
import type { PricingContext, StorePricingProvider } from "./types";
import { StorePricingError } from "./types";

export const TARGET_SETUP_HINT =
  "Target has no public product/price API. Live Target prices require a licensed partner feed: set TARGET_PARTNER_BASE_URL and TARGET_PARTNER_API_KEY. The feed must implement GET {base}/products?query=&zip= with Authorization: Bearer <key>. Do not use RedSky scraping. Until those keys exist, Target rows stay on the demo catalog.";

type PartnerProduct = {
  name?: string;
  brand?: string;
  price?: number;
  productId?: string;
  tcin?: string;
  upc?: string;
  unit?: string;
  size?: string;
};

type PartnerResponse = {
  products?: PartnerProduct[];
  items?: PartnerProduct[];
  data?: PartnerProduct[];
  error?: string;
  message?: string;
};

function readTargetPartnerConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.TARGET_PARTNER_BASE_URL?.trim() ?? "";
  const apiKey = process.env.TARGET_PARTNER_API_KEY?.trim() ?? "";
  if (!baseUrl || !apiKey) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function toCatalogProduct(
  item: PartnerProduct,
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
  const productId = (item.productId || item.tcin)?.trim();
  const upc = item.upc?.trim();
  return {
    name,
    brand: item.brand?.trim() || "Target",
    storeName: "Target",
    ...(productId ? { productId } : {}),
    ...(upc ? { upc } : {}),
    ...(zipCode ? { locationId: zipCode } : {}),
    price,
    unit,
    normalizedUnit: unit,
    priceSource: "live",
  };
}

/**
 * Target live pricing: only a contracted partner feed. There is no official
 * public Target grocery API; redsky.target.com is an internal storefront
 * endpoint and is not used here.
 */
export class TargetPricingProvider implements StorePricingProvider {
  readonly storeName = "Target";

  isConfigured(): boolean {
    return readTargetPartnerConfig() !== null;
  }

  setupHint(): string {
    return TARGET_SETUP_HINT;
  }

  async searchProducts(
    term: string,
    context: PricingContext = {}
  ): Promise<CatalogProduct[]> {
    const query = term.trim();
    if (!query) {
      return [];
    }

    const config = readTargetPartnerConfig();
    if (!config) {
      throw new StorePricingError(
        "Target",
        TARGET_SETUP_HINT,
        "not_available"
      );
    }

    const params = new URLSearchParams({ query });
    if (context.zipCode?.trim()) {
      params.set("zip", context.zipCode.trim().slice(0, 5));
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
        "Target",
        `Target partner feed unavailable (${message})`,
        "network"
      );
    }

    const payload = (await response.json().catch(() => ({}))) as PartnerResponse;
    if (!response.ok) {
      throw new StorePricingError(
        "Target",
        payload.message ||
          payload.error ||
          `Target partner feed failed (${response.status})`,
        "http"
      );
    }

    const rows = payload.products ?? payload.items ?? payload.data ?? [];
    return rows
      .map((row) => toCatalogProduct(row, context.zipCode))
      .filter((product): product is CatalogProduct => product !== null);
  }
}

export const targetPricingProvider = new TargetPricingProvider();
