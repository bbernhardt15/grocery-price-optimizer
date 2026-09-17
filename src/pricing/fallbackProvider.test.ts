import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FallbackPricingProvider } from "./fallbackProvider";
import type { CatalogProduct } from "../optimizeGroceryList";
import type { PricingContext, StorePricingProvider } from "./types";

function stubProvider(
  storeName: string,
  configured: boolean,
  search: StorePricingProvider["searchProducts"]
): StorePricingProvider {
  return {
    storeName,
    isConfigured: () => configured,
    setupHint: () => `${storeName} hint`,
    searchProducts: search,
  };
}

const liveMilk: CatalogProduct = {
  name: "Kroger Milk",
  brand: "Kroger",
  storeName: "Kroger",
  price: 2.1,
  unit: "gal",
  normalizedUnit: "gal",
  priceSource: "live",
};

const weeklyMilk: CatalogProduct = {
  name: "Kroger Milk weekly",
  brand: "Kroger",
  storeName: "Kroger",
  price: 1.99,
  unit: "gal",
  normalizedUnit: "gal",
  priceSource: "weekly_ad",
};

describe("FallbackPricingProvider", () => {
  it("keeps the retailer live path when it returns rows", async () => {
    const provider = new FallbackPricingProvider(
      "Kroger",
      stubProvider("Kroger", true, async () => [liveMilk]),
      stubProvider("Kroger", true, async () => {
        throw new Error("Flipp should not run");
      })
    );
    const rows = await provider.searchProducts("milk", { zipCode: "45202" });
    assert.equal(rows[0].priceSource, "live");
    assert.equal(rows[0].price, 2.1);
  });

  it("uses weekly-ad fallback when the live API returns nothing", async () => {
    const provider = new FallbackPricingProvider(
      "Target",
      stubProvider("Target", false, async () => []),
      stubProvider("Target", true, async (_term: string, context?: PricingContext) => {
        assert.equal(context?.zipCode, "45202");
        return [weeklyMilk];
      })
    );
    assert.equal(provider.isConfigured(), true);
    const rows = await provider.searchProducts("milk", { zipCode: "45202" });
    assert.equal(rows[0].priceSource, "weekly_ad");
  });
});
