import type { SizeDimension } from "../packageSize";

/** How a browse offer was priced. Partner feeds are licensed, not a public retailer API. */
export type OfferPriceSource = "live" | "weekly_ad" | "seed" | "partner_feed";

export type OfferAvailability = "in_stock" | "out_of_stock" | "unknown";

/**
 * One store's price for a product before UPC grouping.
 * Retailer category strings are mapped onto the shared department tree later.
 */
export type RawCatalogRecord = {
  name: string;
  brand: string;
  storeName: string;
  price: number;
  upc?: string;
  productId?: string;
  /** Retailer item id used for cart handoff (Walmart itemId, Kroger productId). */
  retailerItemId?: string;
  locationId?: string;
  /** ZIP this offer was priced for (Kroger location refresh). */
  zip?: string;
  /** Walmart product page, kept for add-to-cart context. */
  productUrl?: string;
  size?: string;
  imageUrls?: string[];
  /** Already-mapped department, when the caller knows it (demo catalog). */
  departmentId?: string;
  subcategory?: string;
  /** Retailer taxonomy labels (Walmart categoryPath, Kroger categories). */
  categories?: string[];
  onSale?: boolean;
  availability?: OfferAvailability;
  priceSource: OfferPriceSource;
  storeBrand?: boolean;
};

export type CatalogOffer = {
  storeName: string;
  price: number;
  unitPrice?: number;
  unitPriceText?: string;
  onSale: boolean;
  availability: OfferAvailability;
  retailerItemId?: string;
  productId?: string;
  upc?: string;
  locationId?: string;
  priceSource: OfferPriceSource;
  sizeLabel?: string;
};

export type PackageSizeSummary = {
  dimension: SizeDimension;
  /** volume: fl oz; weight: oz; count: each */
  amount: number;
  label: string;
};

export type BrowseProduct = {
  /** `upc:{digits}` when offers share a UPC, otherwise a stable local id. */
  id: string;
  upc?: string;
  name: string;
  brand: string;
  imageUrls: string[];
  departmentId: string;
  departmentName: string;
  subcategory?: string;
  sizeLabel?: string;
  packageSize?: PackageSizeSummary;
  storeBrand: boolean;
  offers: CatalogOffer[];
  /** Lowest in-stock (or unknown) shelf price. */
  bestOffer: CatalogOffer;
};

export type StoreCatalogMode =
  | "taxonomy_sample"
  | "search_seeded"
  | "partner_search"
  | "weekly_ad_only"
  | "demo_only";

export type StoreCoverage = {
  storeName: string;
  mode: StoreCatalogMode;
  /** True when a live or partner catalog call can run for this store. */
  liveCatalog: boolean;
  label: string;
  detail: string;
};

export type BrowseSort = "relevance" | "price" | "unitPrice" | "name" | "onSale";

export type SizeClass = "any" | "small" | "standard" | "bulk";

export type BrowseFilters = {
  query?: string;
  departmentId?: string;
  subcategory?: string;
  store?: string;
  brand?: string;
  onSale?: boolean;
  storeBrand?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sizeClass?: SizeClass;
};

export type CatalogGap = {
  storeName: string;
  substitute: {
    productId: string;
    name: string;
    brand: string;
    price: number;
    unitPriceText?: string;
    sizeLabel?: string;
    imageUrl?: string;
    score: number;
    storeBrand: boolean;
  } | null;
};
