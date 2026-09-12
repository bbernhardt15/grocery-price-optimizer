export type CatalogProduct = {
  name: string;
  brand: string;
  storeName: string;
  price: number;
  unit: string;
  normalizedUnit: string;
  lastUpdated?: Date;
};

export type PickedItem = {
  query: string;
  name: string;
  brand: string;
  storeName: string;
  price: number;
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

function uniqueGroceryItems(groceryList: string[]): string[] {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const raw of groceryList) {
    const query = raw.trim();
    if (!query) {
      continue;
    }

    const key = query.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push(query);
  }

  return items;
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
  const query = item.trim().toLowerCase();
  if (!query) {
    return false;
  }

  return product.name.toLowerCase().includes(query);
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

/**
 * Maps each grocery item to the in-scope product with the lowest shelf price,
 * then groups those picks by storeName.
 *
 * `stores` limits which retailers are considered. An empty list means every
 * store in `products` is eligible.
 */
export function optimizeGroceryList(
  groceryList: string[],
  stores: string[],
  products: CatalogProduct[]
): OptimizeResult {
  const items = uniqueGroceryItems(groceryList);
  const storeFilter = allowedStores(stores);
  const catalog =
    storeFilter === null
      ? products
      : products.filter((product) =>
          storeFilter.has(product.storeName.trim().toLowerCase())
        );

  const picks: PickedItem[] = [];
  const unavailable: string[] = [];

  for (const query of items) {
    const matches = catalog.filter((product) =>
      productMatchesItem(product, query)
    );

    if (matches.length === 0) {
      unavailable.push(query);
      continue;
    }

    matches.sort(compareByLowestPrice);
    const best = matches[0];

    picks.push({
      query,
      name: best.name,
      brand: best.brand,
      storeName: best.storeName,
      price: best.price,
      unit: best.unit,
      normalizedUnit: best.normalizedUnit,
    });
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
        storeItems.reduce((sum, item) => sum + item.price, 0)
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
