import type { CatalogProduct } from "../../optimizeGroceryList";
import { parseGroceryUnit } from "../parseGroceryUnit";
import type { PricingContext, StorePricingProvider } from "../types";
import { StorePricingError } from "../types";
import { flippConfigured, searchFlippDealsForStore } from "./client";
import { mappingForStore } from "./merchants";

export const FLIPP_SETUP_HINT =
  "Weekly-ad prices (not a full shelf catalog) use Flipp. Official FlyerKit: set FLIPP_ACCESS_TOKEN from a Flipp technical contact (https://api.flipp.com/flyerkit/v4.0/documentation). The consumer flyer search is unofficial and ToS-sensitive — production must opt in with FLIPP_ENABLED=true. Requires a ZIP. Do not scrape authenticated retailer storefronts.";

/** Shown when Flipp is already on. Do not reuse FLIPP_SETUP_HINT — that reads as “unset env vars”. */
export const FLIPP_ENABLED_HINT =
  "Weekly-ad / circular prices from Flipp are enabled. They are sale prices printed in the flyer, not a full live shelf catalog. Requires a ZIP.";

export class FlippDealsProvider implements StorePricingProvider {
  constructor(readonly storeName: string) {}

  isConfigured(): boolean {
    return Boolean(mappingForStore(this.storeName)) && flippConfigured();
  }

  setupHint(): string {
    if (!mappingForStore(this.storeName)) {
      return `${this.storeName} is not mapped to a Flipp weekly-ad merchant.`;
    }
    if (flippConfigured()) {
      return FLIPP_ENABLED_HINT;
    }
    return `${this.storeName} has no public product API. ${FLIPP_SETUP_HINT}`;
  }

  async searchProducts(
    term: string,
    context: PricingContext = {}
  ): Promise<CatalogProduct[]> {
    const query = term.trim();
    if (!query) {
      return [];
    }
    if (!this.isConfigured()) {
      throw new StorePricingError(this.storeName, this.setupHint(), "not_available");
    }

    const zip = context.zipCode?.trim();
    if (!zip) {
      return [];
    }

    try {
      const deals = await searchFlippDealsForStore(this.storeName, query, zip);
      const zip5 = zip.replace(/\D/g, "").slice(0, 5);

      return deals.map((deal) => {
        const unit = parseGroceryUnit(
          `${deal.name} ${deal.postPriceText ?? ""} ${deal.saleStory ?? ""}`
        );
        return {
          name: deal.name,
          brand: deal.brand || this.storeName,
          storeName: this.storeName,
          locationId: zip5,
          ...(deal.flyerItemId ? { productId: deal.flyerItemId } : {}),
          price: deal.price,
          unit,
          normalizedUnit: unit,
          priceSource: "weekly_ad" as const,
        };
      });
    } catch (error) {
      if (error instanceof StorePricingError) {
        throw new StorePricingError(this.storeName, error.message, error.code);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new StorePricingError(this.storeName, message, "network");
    }
  }
}

const flippProviders = new Map<string, FlippDealsProvider>();

export function flippProviderForStore(
  storeName: string
): FlippDealsProvider | undefined {
  const mapping = mappingForStore(storeName);
  if (!mapping) {
    return undefined;
  }
  const key = mapping.storeName.toLowerCase();
  const existing = flippProviders.get(key);
  if (existing) {
    return existing;
  }
  const created = new FlippDealsProvider(mapping.storeName);
  flippProviders.set(key, created);
  return created;
}
