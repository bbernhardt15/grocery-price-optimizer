import { rawFromCatalogProduct } from "../catalog/providers/fromCatalogProduct";
import type { RawCatalogRecord } from "../catalog/types";
import { krogerService } from "../krogerService";
import { krogerApiConfigured } from "../pricing/krogerProvider";
import { walmartPricingProvider } from "../pricing/walmartProvider";

export type WalmartCatalogClient = {
  taxonomy(): Promise<unknown>;
  page(path: string): Promise<unknown>;
};

export type KrogerPageQuery = {
  term: string;
  locationId?: string;
  start: number;
  limit: number;
  brand?: string;
  departmentId?: string;
  subcategory?: string;
  zip?: string;
};

export type KrogerCatalogClient = {
  page(query: KrogerPageQuery): Promise<{ records: RawCatalogRecord[]; returned: number }>;
  resolveLocation(zip: string): Promise<string | null>;
};

export function walmartAffiliateClient(): WalmartCatalogClient {
  return {
    taxonomy: () => walmartPricingProvider.getJson("/taxonomy"),
    page: (path) => walmartPricingProvider.getJson(path),
  };
}

export function krogerProductsClient(): KrogerCatalogClient {
  return {
    async page(query) {
      const page = await krogerService.searchProductsPage({
        term: query.term,
        locationId: query.locationId,
        start: query.start,
        limit: query.limit,
        brand: query.brand,
      });
      const records: RawCatalogRecord[] = [];
      for (const product of page.products) {
        const raw = rawFromCatalogProduct(product, "live");
        if (!raw) {
          continue;
        }
        raw.departmentId = query.departmentId;
        raw.subcategory = query.subcategory;
        raw.zip = query.zip;
        if (query.locationId) {
          raw.locationId = query.locationId;
        }
        records.push(raw);
      }
      return { records, returned: page.returned };
    },
    async resolveLocation(zip) {
      if (!krogerApiConfigured()) {
        return null;
      }
      const locationId = await krogerService.getClosestStoreLocationStrict(zip);
      return locationId?.trim() || null;
    },
  };
}
