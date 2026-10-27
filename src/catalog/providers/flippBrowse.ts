import { mapToDepartment } from "../departments";
import type { RawCatalogRecord } from "../types";
import { rawFromCatalogProduct } from "./fromCatalogProduct";
import { krogerApiConfigured } from "../../pricing/krogerProvider";
import { partnerStoreNamesFromEnv } from "../../pricing/partnerProviders";
import { targetPricingProvider } from "../../pricing/targetProvider";
import { walmartPricingProvider } from "../../pricing/walmartProvider";
import {
  flippAccessToken,
  flippConsumerEnabled,
  loadWeeklyAdDeals,
  searchFlippDealsForStore,
  weeklyAdNameMatches,
  type NormalizedFlippDeal,
} from "../../pricing/flipp/client";
import { FLIPP_ZIP_NOTICE } from "../../pricing/flipp/flippProvider";
import { FLIPP_MERCHANT_MAPPINGS } from "../../pricing/flipp/merchants";
import type { CatalogProduct } from "../../optimizeGroceryList";
import { searchTermsFor } from "../searchTerms";

const MAX_PER_STORE = 48;

/**
 * Banners whose browse shelf can show a weekly circular. Kroger, Walmart, and
 * Target are skipped when their own live or partner feed is already configured.
 * A licensed partner feed for the same banner also wins.
 */
export function weeklyAdBrowseStores(): string[] {
  const partners = new Set(partnerStoreNamesFromEnv().map((store) => store.toLowerCase()));
  return FLIPP_MERCHANT_MAPPINGS.map((mapping) => mapping.storeName).filter((storeName) => {
    const key = storeName.toLowerCase();
    if (partners.has(key)) {
      return false;
    }
    if (key === "kroger" && krogerApiConfigured()) {
      return false;
    }
    if (key === "walmart" && walmartPricingProvider.isConfigured()) {
      return false;
    }
    if (key === "target" && targetPricingProvider.isConfigured()) {
      return false;
    }
    return true;
  });
}

function dealToRecord(storeName: string, deal: NormalizedFlippDeal, zip: string): RawCatalogRecord | null {
  const mapped = mapToDepartment(undefined, deal.name);
  if (mapped.signal === "excluded") {
    return null;
  }
  const product: CatalogProduct = {
    name: deal.name,
    brand: deal.brand || storeName,
    storeName,
    locationId: zip,
    price: deal.price,
    unit: "count",
    normalizedUnit: "count",
    priceSource: "weekly_ad",
    onSale: true,
    ...(deal.regularPrice != null ? { regularPrice: deal.regularPrice } : {}),
    ...(deal.saleEndsOn ? { saleEndsOn: deal.saleEndsOn } : {}),
    ...(deal.flyerItemId ? { productId: deal.flyerItemId } : {}),
    ...(deal.postPriceText ? { size: deal.postPriceText } : {}),
    ...(deal.imageUrl ? { imageUrls: [deal.imageUrl] } : {}),
  };
  const raw = rawFromCatalogProduct(product, "weekly_ad");
  if (!raw) {
    return null;
  }
  return {
    ...raw,
    departmentId: mapped.departmentId,
    ...(mapped.subcategory ? { subcategory: mapped.subcategory } : {}),
  };
}

async function dealsForStore(
  storeName: string,
  zip: string,
  query: string | undefined,
  departmentId: string | undefined
): Promise<NormalizedFlippDeal[]> {
  if (flippConsumerEnabled()) {
    return loadWeeklyAdDeals(storeName, zip);
  }
  if (!flippAccessToken()) {
    return [];
  }
  const terms = query ? [query] : searchTermsFor(departmentId ?? "").slice(0, 2);
  const deals: NormalizedFlippDeal[] = [];
  for (const term of terms) {
    const rows = await searchFlippDealsForStore(storeName, term, zip);
    deals.push(
      ...rows.map((row) => ({
        name: row.name,
        brand: row.brand || storeName,
        merchantName: storeName,
        price: row.price,
        ...(row.flyerItemId ? { flyerItemId: row.flyerItemId } : {}),
        ...(row.postPriceText ? { postPriceText: row.postPriceText } : {}),
        ...(row.saleStory ? { saleStory: row.saleStory } : {}),
        ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
        ...(row.regularPrice != null ? { regularPrice: row.regularPrice } : {}),
        ...(row.saleEndsOn ? { saleEndsOn: row.saleEndsOn } : {}),
      }))
    );
  }
  return deals;
}

/**
 * Weekly-ad rows for browse/search. Empty when Flipp is off, when no ZIP was
 * sent, or when the circular has nothing in this aisle. Never writes the
 * catalog ingest collections.
 */
export async function fetchWeeklyAdRecords(options: {
  zipCode?: string;
  query?: string;
  departmentId?: string;
  warnings: string[];
}): Promise<RawCatalogRecord[]> {
  const query = options.query?.trim();
  const departmentId = options.departmentId?.trim();
  const scoped = Boolean(departmentId) || Boolean(query && query.length >= 2);
  if (!scoped || weeklyAdBrowseStores().length === 0) {
    return [];
  }
  if (!flippConsumerEnabled() && !flippAccessToken()) {
    return [];
  }

  const zip = options.zipCode?.replace(/\D/g, "").slice(0, 5);
  if (!zip || !/^\d{5}$/.test(zip)) {
    options.warnings.push(FLIPP_ZIP_NOTICE);
    return [];
  }

  const records: RawCatalogRecord[] = [];
  await Promise.all(
    weeklyAdBrowseStores().map(async (storeName) => {
      try {
        const deals = await dealsForStore(storeName, zip, query, departmentId);
        let kept = 0;
        for (const deal of deals) {
          if (query && query.length >= 2 && !weeklyAdNameMatches(deal.name, query)) {
            continue;
          }
          const record = dealToRecord(storeName, deal, zip);
          if (!record) {
            continue;
          }
          if (departmentId && record.departmentId !== departmentId) {
            continue;
          }
          records.push(record);
          kept += 1;
          if (kept >= MAX_PER_STORE) {
            break;
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.warnings.push(`${storeName} weekly ad failed: ${message}`);
      }
    })
  );
  return records;
}
