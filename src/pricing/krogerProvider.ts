import { KrogerPricingError, krogerService } from "../krogerService";
import type { CatalogProduct } from "../optimizeGroceryList";
import type { PricingContext, StorePricingProvider } from "./types";
import { StorePricingError } from "./types";

export function krogerApiConfigured(): boolean {
  return Boolean(
    process.env.KROGER_CLIENT_ID?.trim() &&
      process.env.KROGER_CLIENT_SECRET?.trim()
  );
}

export const KROGER_SETUP_HINT =
  "Kroger live prices need KROGER_CLIENT_ID and KROGER_CLIENT_SECRET (client-credentials, product.compact).";

export class KrogerPricingProvider implements StorePricingProvider {
  readonly storeName = "Kroger";

  isConfigured(): boolean {
    return krogerApiConfigured();
  }

  setupHint(): string {
    return KROGER_SETUP_HINT;
  }

  async searchProducts(
    term: string,
    context: PricingContext = {}
  ): Promise<CatalogProduct[]> {
    try {
      const products = await krogerService.searchProducts(
        term,
        context.locationId
      );
      return products.map((product) => ({
        ...product,
        storeName: "Kroger",
        priceSource: "live" as const,
      }));
    } catch (error) {
      if (error instanceof KrogerPricingError) {
        throw new StorePricingError(
          "Kroger",
          error.message,
          error.code === "missing_credentials" ||
            error.code === "http" ||
            error.code === "network"
            ? error.code
            : "http"
        );
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new StorePricingError("Kroger", message, "network");
    }
  }
}

export const krogerPricingProvider = new KrogerPricingProvider();
