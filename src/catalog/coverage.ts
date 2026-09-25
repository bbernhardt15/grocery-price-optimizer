import type { StoreCatalogMode, StoreCoverage } from "./types";

export type CoverageFlags = {
  kroger: boolean;
  walmart: boolean;
  targetPartner: boolean;
  flipp: boolean;
  partnerStores: string[];
};

const DEFAULT_STORES = ["Aldi", "Kroger", "Target", "Walmart"] as const;

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
    flags.walmart
      ? coverage(
          "Walmart",
          "taxonomy_sample",
          true,
          "Walmart category sample",
          "Browse uses the Affiliate taxonomy and the first page of paginated items for a grocery category when that category id is returned. If taxonomy or paginated items is empty, Grocery Gitter falls back to a few search terms. Prices are walmart.com catalog prices — the search API has no store-price filter. This is not the full Walmart assortment."
        )
      : coverage(
          "Walmart",
          "demo_only",
          false,
          "Demo catalog",
          "Set WALMART_CONSUMER_ID and WALMART_PRIVATE_KEY to browse a live Walmart category sample. Until then this shelf is the demo catalog."
        ),
    flags.kroger
      ? coverage(
          "Kroger",
          "search_seeded",
          true,
          "Kroger search sample",
          "Kroger's Products API is search-by-term (and brand). It does not offer category browse. Each department is filled with a few seeded search terms, then classified with the categories field on those results plus the product name. This is a sample of the aisle, not the full Kroger catalog. Prices use the ZIP's nearest store when a location id is available."
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
            ? "Flipp can price Target items that are printed in the weekly ad during trip planning. Weekly ads are not a browsable catalog, so department shelves stay on the demo catalog."
            : "Target has no public product catalog API. Department shelves stay on the demo catalog until a licensed partner feed is configured. RedSky is not used."
        ),
    coverage(
      "Aldi",
      flags.flipp ? "weekly_ad_only" : "demo_only",
      false,
      flags.flipp ? "Weekly ad only" : "Demo catalog",
      flags.flipp
        ? "Aldi has no product catalog API. Flipp weekly ads can fill trip-plan prices for items on the circular, but browse shelves stay on the demo catalog. Weekly ad is not a full assortment."
        : "Aldi has no product catalog API. Browse shows the demo catalog only. Nothing here is a live Aldi shelf."
    ),
  ];

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
