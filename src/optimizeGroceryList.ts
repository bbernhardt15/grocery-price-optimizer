import { mapToDepartment } from "./catalog/departments";
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
  /** Stable id for this grocery line, used to remember checks and moves. */
  lineId?: string;
  /** Department name when the catalog or the product name maps to one. */
  department?: string;
  /** Aisle or subcategory when one is known. */
  aisle?: string;
  /** Cheapest offer at each store that carries this line, including the winner. */
  offers?: ItemOffer[];
};

/** One store's price for a line, so the shopper can move it and re-total offline. */
export type ItemOffer = {
  storeName: string;
  name: string;
  brand: string;
  price: number;
  unit: string;
  normalizedUnit: string;
  size?: string;
  productId?: string;
  upc?: string;
  locationId?: string;
  priceSource?: PriceSource;
  department?: string;
  aisle?: string;
  /** Filled in when the trip is enriched with handoff links. */
  url?: string;
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

function rankedMatches(line: GroceryLine, catalog: CatalogProduct[]): CatalogProduct[] {
  const matches = productsMatchingQuery(catalog, line.name);
  matches.sort((a, b) =>
    compareProductOffers(
      line.name,
      a.offerRole === "substitute" ? { ...a, name: line.name } : a,
      b.offerRole === "substitute" ? { ...b, name: line.name } : b
    )
  );
  return matches;
}

function toItemOffer(product: CatalogProduct): ItemOffer {
  const mapped = mapToDepartment(product.categories, product.name);
  return {
    storeName: product.storeName,
    name: product.name,
    brand: product.brand,
    price: product.price,
    unit: product.unit,
    normalizedUnit: product.normalizedUnit,
    ...(product.size ? { size: product.size } : {}),
    ...(product.productId ? { productId: product.productId } : {}),
    ...(product.upc ? { upc: product.upc } : {}),
    ...(product.locationId ? { locationId: product.locationId } : {}),
    ...(product.priceSource ? { priceSource: product.priceSource } : {}),
    department: mapped.departmentName,
    ...(mapped.subcategory ? { aisle: mapped.subcategory } : {}),
  };
}

/** First match per store wins because `matches` is already ranked best-first. */
function bestOfferPerStore(matches: CatalogProduct[]): ItemOffer[] {
  const seen = new Set<string>();
  const offers: ItemOffer[] = [];
  for (const product of matches) {
    const key = product.storeName.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    offers.push(toItemOffer(product));
  }
  return offers;
}

function pickForLine(
  line: GroceryLine,
  catalog: CatalogProduct[]
): PickedItem | null {
  const matches = rankedMatches(line, catalog);

  if (matches.length === 0) {
    return null;
  }

  const best = matches[0];
  const unitPrice = unitPriceForProduct(best.price, best.name, best.size);
  const mapped = mapToDepartment(best.categories, best.name);

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
    department: mapped.departmentName,
    ...(mapped.subcategory ? { aisle: mapped.subcategory } : {}),
    offers: bestOfferPerStore(matches),
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

  items.forEach((line, index) => {
    const pick = pickForLine(line, catalog);
    if (!pick) {
      unavailable.push(line.name);
      return;
    }

    picks.push({
      ...pick,
      lineId: `${index}:${line.name.trim().toLowerCase()}`,
    });
  });

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
