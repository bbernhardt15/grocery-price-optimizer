import type { GroceryLine } from "./parseGroceryLine";
import { parseGroceryList } from "./parseGroceryLine";
import { compareProductOffers, unitPriceForProduct } from "./productMatch";
import {
  matchTokenSets,
  nameContainsAllTokens,
} from "./productSearchQuery";

export type PriceSource = "live" | "cached_live" | "weekly_ad" | "seed";

export type CatalogProduct = {
  name: string;
  brand: string;
  storeName: string;
  locationId?: string;
  /** Retailer product id when known (Kroger Products API `productId`, typically the UPC). */
  productId?: string;
  /** UPC / GTIN when known. For Kroger this is usually the same as `productId`. */
  upc?: string;
  price: number;
  unit: string;
  normalizedUnit: string;
  lastUpdated?: Date;
  updatedAt?: Date;
  /** Retailer size text ("12 oz", "1 gal", "18 ct") when the API sent one. */
  size?: string;
  /** In-memory: the grocery line that fetched this row for this request. */
  sourceQuery?: string;
  /**
   * Browse checkout pins the shopper's chosen offers so a cheaper lookalike
   * in the seed catalog cannot replace the product they selected.
   */
  pinned?: boolean;
  /** Substitute rows compete only when the shopper allows them. */
  offerRole?: "exact" | "substitute";
  substitutedFor?: string;
  /** live = retailer API this request; cached_live = Mongo row from a live API; weekly_ad = flyer/circular; seed = demo catalog. */
  priceSource?: PriceSource;
  imageUrls?: string[];
  categories?: string[];
  onSale?: boolean;
  availability?: "in_stock" | "out_of_stock" | "unknown";
};

export type PickedItem = {
  query: string;
  name: string;
  brand: string;
  storeName: string;
  price: number;
  quantity: number;
  itemTotal: number;
  unit: string;
  normalizedUnit: string;
  /** Retailer package text ("1 gal", "16 oz", "12 ct") when the catalog had one. */
  size?: string;
  /** Package unit price rounded to cents, in the same units as `unitPriceText`. */
  unitPrice?: number;
  /** For example "$3.29/gal" or "$0.20/ct" when the package size was parsed. */
  unitPriceText?: string;
  locationId?: string;
  productId?: string;
  upc?: string;
  priceSource?: PriceSource;
  /** Set when the winning offer is a labeled substitute, not the exact UPC. */
  matchKind?: "exact" | "substitute";
  substitutedFor?: string;
};

export type StoreGroup = {
  storeName: string;
  items: PickedItem[];
  subtotal: number;
};

export type OptimizeResult = {
  stores: StoreGroup[];
  unavailable: string[];
  total: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function allowedStores(stores: string[]): Set<string> | null {
  const names = stores
    .map((store) => store.trim().toLowerCase())
    .filter((store) => store.length > 0);

  return names.length === 0 ? null : new Set(names);
}

export function productMatchesItem(
  product: CatalogProduct,
  item: string
): boolean {
  if (product.sourceQuery && product.sourceQuery === item) {
    return true;
  }

  return matchTokenSets(item).some((tokens) =>
    nameContainsAllTokens(product.name, tokens)
  );
}

function offerKey(product: CatalogProduct): string {
  return [
    product.storeName.trim().toLowerCase(),
    product.upc ?? "",
    product.name.trim().toLowerCase(),
    product.price,
    product.size ?? "",
  ].join("|");
}

function dedupeCandidates(products: CatalogProduct[]): CatalogProduct[] {
  const map = new Map<string, CatalogProduct>();
  for (const product of products) {
    const key = offerKey(product);
    const existing = map.get(key);
    if (!existing || (existing.offerRole === "substitute" && product.offerRole !== "substitute")) {
      map.set(key, product);
    }
  }
  return [...map.values()];
}

function productsMatchingQuery(
  catalog: CatalogProduct[],
  item: string
): CatalogProduct[] {
  const substitutes = catalog.filter(
    (product) => product.offerRole === "substitute" && product.sourceQuery === item
  );
  const pinned = catalog.filter(
    (product) => product.pinned && product.sourceQuery === item && product.offerRole !== "substitute"
  );
  if (pinned.length > 0) {
    return dedupeCandidates([...pinned, ...substitutes]);
  }

  let matches: CatalogProduct[] = [];
  for (const tokens of matchTokenSets(item)) {
    const found = catalog.filter((product) => nameContainsAllTokens(product.name, tokens));
    if (found.length > 0) {
      matches = found;
      break;
    }
  }

  if (matches.length === 0) {
    matches = catalog.filter(
      (product) => product.sourceQuery === item && product.offerRole !== "substitute"
    );
  }

  return dedupeCandidates([...matches, ...substitutes]);
}

function pickForLine(
  line: GroceryLine,
  catalog: CatalogProduct[]
): PickedItem | null {
  const matches = productsMatchingQuery(catalog, line.name);

  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) =>
    compareProductOffers(
      line.name,
      a.offerRole === "substitute" ? { ...a, name: line.name } : a,
      b.offerRole === "substitute" ? { ...b, name: line.name } : b
    )
  );
  const best = matches[0];
  const unitPrice = unitPriceForProduct(best.price, best.name, best.size);

  return {
    query: line.name,
    name: best.name,
    brand: best.brand,
    storeName: best.storeName,
    price: best.price,
    quantity: line.quantity,
    itemTotal: roundMoney(best.price * line.quantity),
    unit: best.unit,
    normalizedUnit: best.normalizedUnit,
    ...(best.size ? { size: best.size } : {}),
    ...(unitPrice ?? {}),
    ...(best.locationId ? { locationId: best.locationId } : {}),
    ...(best.productId ? { productId: best.productId } : {}),
    ...(best.upc ? { upc: best.upc } : {}),
    ...(best.priceSource ? { priceSource: best.priceSource } : {}),
    ...(best.offerRole === "substitute"
      ? {
          matchKind: "substitute" as const,
          substitutedFor: best.substitutedFor || line.name,
        }
      : {}),
  };
}

/**
 * Maps each grocery item to one in-scope product, multiplies that shelf price
 * by the requested quantity, then groups by storeName.
 *
 * Candidates are the strongest keyword set that hits (full name, then without
 * a generic trailing word, then the first two words). Inside that set the
 * product itself beats a flavor/ingredient use of the same words, then either
 * the closest requested package size or the lower unit price. See
 * `productMatch.ts` for the full rule.
 */
export function optimizeGroceryList(
  groceryList: string[],
  stores: string[],
  products: CatalogProduct[]
): OptimizeResult {
  const items = parseGroceryList(groceryList);
  const storeFilter = allowedStores(stores);
  const catalog =
    storeFilter === null
      ? products
      : products.filter((product) =>
          storeFilter.has(product.storeName.trim().toLowerCase())
        );

  const picks: PickedItem[] = [];
  const unavailable: string[] = [];

  for (const line of items) {
    const pick = pickForLine(line, catalog);
    if (!pick) {
      unavailable.push(line.name);
      continue;
    }

    picks.push(pick);
  }

  const grouped = new Map<string, PickedItem[]>();
  for (const pick of picks) {
    const existing = grouped.get(pick.storeName);
    if (existing) {
      existing.push(pick);
    } else {
      grouped.set(pick.storeName, [pick]);
    }
  }

  const storeGroups: StoreGroup[] = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([storeName, storeItems]) => ({
      storeName,
      items: storeItems,
      subtotal: roundMoney(
        storeItems.reduce((sum, item) => sum + item.itemTotal, 0)
      ),
    }));

  return {
    stores: storeGroups,
    unavailable,
    total: roundMoney(
      storeGroups.reduce((sum, group) => sum + group.subtotal, 0)
    ),
  };
}
