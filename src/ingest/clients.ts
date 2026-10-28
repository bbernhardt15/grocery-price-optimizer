import { rawFromCatalogProduct } from "../catalog/providers/fromCatalogProduct";
import type { RawCatalogRecord } from "../catalog/types";
import type { CatalogProduct } from "../optimizeGroceryList";
import { krogerService } from "../krogerService";
import { krogerApiConfigured } from "../pricing/krogerProvider";
import { walmartPricingProvider } from "../pricing/walmartProvider";

export type WalmartCatalogClient = {
  taxonomy(): Promise<unknown>;
  page(path: string): Promise<unknown>;
  /** Affiliate GET /items?upc=. Optional so tests that only page stay quiet. */
  lookupUpc?(upc: string): Promise<unknown>;
  /** One Affiliate call for several UPCs (comma-separated, up to 20). */
  lookupUpcs?(upcs: string[]): Promise<unknown>;
  /** One Affiliate call for several item ids (`ids`, up to 20). */
  lookupIds?(ids: string[]): Promise<unknown>;
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
  /** Products API filter.productId. Optional so term-only tests stay quiet. */
  lookupProductId?(productId: string, locationId?: string): Promise<{ records: RawCatalogRecord[]; returned: number }>;
  /** Name search used when filter.productId is rejected or returns nothing. */
  lookupTerm?(term: string, locationId?: string): Promise<{ records: RawCatalogRecord[]; returned: number }>;
};

export function walmartAffiliateClient(): WalmartCatalogClient {
  return {
    taxonomy: () => walmartPricingProvider.getJson("/taxonomy"),
    page: (path) => walmartPricingProvider.getJson(path),
    lookupUpc: (upc) => walmartPricingProvider.lookupByUpc(upc),
    lookupUpcs: (upcs) => walmartPricingProvider.lookupByUpcs(upcs),
    lookupIds: (ids) => walmartPricingProvider.lookupByIds(ids),
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
    async lookupProductId(productId, locationId) {
      const page = await krogerService.productsById(productId, locationId);
      return krogerLookupRecords(page.products, locationId, page.returned);
    },
    async lookupTerm(term, locationId) {
      const page = await krogerService.searchProductsPage({
        term,
        locationId,
        start: 0,
        limit: 8,
      });
      return krogerLookupRecords(page.products, locationId, page.returned);
    },
  };
}

function krogerLookupRecords(
  products: CatalogProduct[],
  locationId: string | undefined,
  returned: number
): { records: RawCatalogRecord[]; returned: number } {
  const records: RawCatalogRecord[] = [];
  for (const product of products) {
    const raw = rawFromCatalogProduct(product, "live");
    if (!raw) {
      continue;
    }
    if (locationId) {
      raw.locationId = locationId;
    }
    records.push(raw);
  }
  return { records, returned };
}
