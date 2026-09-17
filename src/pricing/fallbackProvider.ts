import type { CatalogProduct } from "../optimizeGroceryList";
import type { PricingContext, StorePricingProvider } from "./types";

/**
 * Tries a retailer API first (Kroger Products, Walmart Affiliate, Target
 * partner feed). On miss or failure, uses weekly-ad / deals data (Flipp).
 */
export class FallbackPricingProvider implements StorePricingProvider {
  constructor(
    readonly storeName: string,
    private readonly primary: StorePricingProvider,
    private readonly fallback: StorePricingProvider
  ) {}

  get feedKind() {
    return this.primary.feedKind;
  }

  isConfigured(): boolean {
    return this.primary.isConfigured() || this.fallback.isConfigured();
  }

  setupHint(): string {
    if (this.primary.isConfigured()) {
      return this.primary.setupHint();
    }
    if (this.fallback.isConfigured()) {
      return this.fallback.setupHint();
    }
    return `${this.primary.setupHint()} ${this.fallback.setupHint()}`;
  }

  async searchProducts(
    term: string,
    context: PricingContext = {}
  ): Promise<CatalogProduct[]> {
    let primaryError: unknown;
    if (this.primary.isConfigured()) {
      try {
        const rows = await this.primary.searchProducts(term, context);
        if (rows.length > 0) {
          return rows.map((row) => ({
            ...row,
            storeName: this.storeName,
          }));
        }
      } catch (error) {
        primaryError = error;
      }
    }

    if (this.fallback.isConfigured()) {
      try {
        const rows = await this.fallback.searchProducts(term, context);
        if (rows.length > 0) {
          return rows.map((row) => ({
            ...row,
            storeName: this.storeName,
          }));
        }
      } catch (error) {
        if (primaryError) {
          throw primaryError;
        }
        throw error;
      }
    }

    if (primaryError) {
      throw primaryError;
    }
    return [];
  }
}
