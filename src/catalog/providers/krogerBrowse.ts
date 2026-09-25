import { krogerService } from "../../krogerService";
import { krogerApiConfigured } from "../../pricing/krogerProvider";
import { searchTermsFor } from "../searchTerms";
import type { RawCatalogRecord } from "../types";
import { rawFromCatalogProduct } from "./fromCatalogProduct";

/**
 * Kroger Products has no category-browse endpoint. Department shelves are a
 * couple of seeded `filter.term` searches. The `categories` array on each
 * hit (when product.compact sends one) is mapped onto the shared tree; the
 * product name covers hits that omit categories. This is a sample, not the aisle.
 */
export async function fetchKrogerDepartment(
  departmentId: string,
  locationId?: string
): Promise<RawCatalogRecord[]> {
  if (!krogerApiConfigured()) {
    return [];
  }
  const records: RawCatalogRecord[] = [];
  for (const term of searchTermsFor(departmentId)) {
    const products = await krogerService.searchProducts(term, locationId);
    for (const product of products) {
      const raw = rawFromCatalogProduct(product, "live");
      if (raw) {
        records.push(raw);
      }
    }
  }
  return records;
}

export async function fetchKrogerSearch(
  query: string,
  locationId?: string
): Promise<RawCatalogRecord[]> {
  if (!krogerApiConfigured()) {
    return [];
  }
  const products = await krogerService.searchProducts(query, locationId);
  return products
    .map((product) => rawFromCatalogProduct(product, "live"))
    .filter((row): row is RawCatalogRecord => row !== null);
}
