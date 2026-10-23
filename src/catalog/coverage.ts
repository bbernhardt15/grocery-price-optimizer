import { FLIPP_MERCHANT_MAPPINGS } from "../pricing/flipp/merchants";
import type { StoreCatalogMode, StoreCoverage } from "./types";

export type CoverageFlags = {
  kroger: boolean;
  walmart: boolean;
  targetPartner: boolean;
  flipp: boolean;
  partnerStores: string[];
  /** Browse is reading the ingested Mongo catalog, not a live page. */
  stored?: boolean;
};

const DEFAULT_STORES = ["Aldi", "Kroger", "Target", "Walmart"] as const;

const WEEKLY_AD_ZIP =
  "A 5-digit US ZIP is required (ZIP+4 is shortened to five digits). Prices are the circular Flipp publishes for that ZIP, not a national shelf and not an in-aisle price.";

function coverage(
  storeName: string,
  mode: StoreCatalogMode,
  liveCatalog: boolean,
  label: string,
  detail: string
): StoreCoverage {
  return { storeName, mode, liveCatalog, label, detail };
}

/**
 * Honest browse coverage. Weekly ads and missing keys are not described as a
 * full shelf. Kroger has no category-browse endpoint; Walmart's Affiliate
 * taxonomy is a first-page sample, and walmart.com prices are not in-aisle.
 */
export function catalogCoverage(flags: CoverageFlags): StoreCoverage[] {
  const rows: StoreCoverage[] = [
    flags.stored
      ? coverage(
          "Walmart",
          "taxonomy_sample",
          flags.walmart,
          "Stored Walmart catalog",
          "Browse reads Grocery Gitter's database. A background job walks the Affiliate grocery taxonomy and pages /paginated/items with nextPage until each category is exhausted or the daily budget runs out. Prices are walmart.com catalog prices, not in-aisle. Shelves are only as deep as that job has filled."
        )
      : flags.walmart
      ? coverage(
          "Walmart",
          "taxonomy_sample",
          true,
          "Walmart category sample",
          "Browse uses the Affiliate taxonomy and the first page of paginated items for a grocery category when that category id is returned. If taxonomy or paginated items is empty, Grocery Gitter falls back to a few search terms. Prices are walmart.com catalog prices — the search API has no store-price filter. This is not the full Walmart assortment. Turn on catalog ingestion to fill the database instead."
        )
      : coverage(
          "Walmart",
          "demo_only",
          false,
          "Demo catalog",
          "Set WALMART_CONSUMER_ID and WALMART_PRIVATE_KEY to browse a live Walmart category sample. Until then this shelf is the demo catalog."
        ),
    flags.stored
      ? coverage(
          "Kroger",
          "search_seeded",
          flags.kroger,
          "Stored Kroger catalog",
          "Kroger has no category browse. The ingestion job pages filter.term (and a few brands) per department and stores a price per location. Browse shows the shopper ZIP's store when that location has been refreshed, otherwise a seeded metro. This is not the entire Kroger assortment; it is whatever the term list and daily budget have saved."
        )
      : flags.kroger
      ? coverage(
          "Kroger",
          "search_seeded",
          true,
          "Kroger search sample",
          "Kroger's Products API is search-by-term (and brand). It does not offer category browse. Each department is filled with a few seeded search terms, then classified with the categories field on those results plus the product name. This is a sample of the aisle, not the full Kroger catalog. Prices use the ZIP's nearest store when a location id is available. Turn on catalog ingestion to page a broader term list into Mongo."
        )
      : coverage(
          "Kroger",
          "demo_only",
          false,
          "Demo catalog",
          "Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET for a search-seeded department sample. Until then this shelf is the demo catalog."
        ),
    flags.targetPartner
      ? coverage(
          "Target",
          "partner_search",
          true,
          "Target partner search",
          "There is no public Target category tree. When TARGET_PARTNER_BASE_URL and TARGET_PARTNER_API_KEY are set, department browse runs the same seeded search terms against that licensed feed. It is not a full Target catalog."
        )
      : coverage(
          "Target",
          flags.flipp ? "weekly_ad_only" : "demo_only",
          false,
          flags.flipp ? "Weekly ad only" : "Demo catalog",
          flags.flipp
            ? `Target has no public shelf API. RedSky, Target Circle offers, and RedCard discounts are not used. Browse, search, and the trip plan show this week's Target circular when Flipp has one for the ZIP, labeled weekly ad, not a shelf price. Items that are not on the flyer stay on the demo catalog. ${WEEKLY_AD_ZIP}`
            : "Target has no public product catalog API. Department shelves stay on the demo catalog until a licensed partner feed or Flipp weekly ads are configured. RedSky is not used."
        ),
    coverage(
      "Aldi",
      flags.flipp ? "weekly_ad_only" : "demo_only",
      false,
      flags.flipp ? "Weekly ad only" : "Demo catalog",
      flags.flipp
        ? `Aldi has no product catalog API and no third-party cart. Browse, search, and the trip plan show Aldi circular prices when Flipp has a flyer for the ZIP, labeled weekly ad, not a shelf price. Many staples are never in the ad; those stay on the demo catalog or Unavailable. ${WEEKLY_AD_ZIP}`
        : "Aldi has no product catalog API. Browse shows the demo catalog only. Nothing here is a live Aldi shelf."
    ),
  ];

  if (flags.flipp) {
    for (const mapping of FLIPP_MERCHANT_MAPPINGS) {
      if (!mapping.dealsOnly) {
        continue;
      }
      const storeName = mapping.storeName;
      if (rows.some((row) => row.storeName.toLowerCase() === storeName.toLowerCase())) {
        continue;
      }
      if (flags.partnerStores.some((name) => name.toLowerCase() === storeName.toLowerCase())) {
        continue;
      }
      const club = mapping.club
        ? " Warehouse prices can require a membership, and there is no third-party cart write."
        : " There is no public cart-write API for this banner.";
      rows.push(
        coverage(
          storeName,
          "weekly_ad_only",
          false,
          "Weekly ad",
          `${storeName} has no public grocery price API. When this ZIP has a current circular, browse and search show those items as the weekly ad, not a shelf price, and the default trip includes the banner only when a circular item is the winning deal.${club} ${WEEKLY_AD_ZIP}`
        )
      );
    }
  }

  for (const storeName of flags.partnerStores) {
    if (DEFAULT_STORES.some((name) => name.toLowerCase() === storeName.toLowerCase())) {
      continue;
    }
    rows.push(
      coverage(
        storeName,
        "partner_search",
        true,
        "Partner search",
        `${storeName} is a licensed partner feed stub (search-by-term), not a retailer category tree. Unconfigured banners are omitted. See docs/PARTNER_INTEGRATIONS.md.`
      )
    );
  }

  return rows;
}
