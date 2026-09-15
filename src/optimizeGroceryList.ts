import type { GroceryLine } from "./parseGroceryLine";
import { parseGroceryList } from "./parseGroceryLine";
import {
  matchTokenSets,
  nameContainsAllTokens,
} from "./productSearchQuery";

export type CatalogProduct = {
  name: string;
  brand: string;
  storeName: string;
  locationId?: string;
  price: number;
  unit: string;
  normalizedUnit: string;
  lastUpdated?: Date;
  updatedAt?: Date;
  /** In-memory: the grocery line that fetched this row for this request. */
  sourceQuery?: string;
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

function productsMatchingQuery(
  catalog: CatalogProduct[],
  item: string
): CatalogProduct[] {
  for (const tokens of matchTokenSets(item)) {
    const matches = catalog.filter((product) =>
      nameContainsAllTokens(product.name, tokens)
    );
    if (matches.length > 0) {
      return matches;
    }
  }

  const sourced = catalog.filter((product) => product.sourceQuery === item);
  if (sourced.length > 0) {
    return sourced;
  }

  return [];
}

function compareByLowestPrice(a: CatalogProduct, b: CatalogProduct): number {
  if (a.price !== b.price) {
    return a.price - b.price;
  }

  const storeCmp = a.storeName.localeCompare(b.storeName);
  if (storeCmp !== 0) {
    return storeCmp;
  }

  return a.name.localeCompare(b.name);
}

function pickForLine(
  line: GroceryLine,
  catalog: CatalogProduct[]
): PickedItem | null {
  const matches = productsMatchingQuery(catalog, line.name);

  if (matches.length === 0) {
    return null;
  }

  matches.sort(compareByLowestPrice);
  const best = matches[0];

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
  };
}

/**
 * Maps each grocery item to the in-scope product with the lowest shelf price,
 * multiplies that price by the requested quantity, then groups by storeName.
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
