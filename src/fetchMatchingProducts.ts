import { Product } from "./models/Product";
import { escapeRegex } from "./escapeRegex";
import type { CatalogProduct } from "./optimizeGroceryList";

function nameFilter(groceryList: string[]): Record<string, unknown> | null {
  const names = groceryList.map((item) => item.trim()).filter(Boolean);
  if (names.length === 0) {
    return null;
  }

  return {
    $or: names.map((name) => ({
      name: { $regex: escapeRegex(name), $options: "i" },
    })),
  };
}

function storeFilter(stores: string[]): Record<string, unknown> | null {
  const names = stores.map((store) => store.trim()).filter(Boolean);
  if (names.length === 0) {
    return null;
  }

  return {
    $or: names.map((store) => ({
      storeName: { $regex: `^${escapeRegex(store)}$`, $options: "i" },
    })),
  };
}

export async function fetchMatchingProducts(
  groceryList: string[],
  stores: string[]
): Promise<CatalogProduct[]> {
  const names = nameFilter(groceryList);
  if (names === null) {
    return [];
  }

  const storesClause = storeFilter(stores);
  const filter =
    storesClause === null ? names : { $and: [names, storesClause] };

  const docs = await Product.find(filter).lean();

  return docs.map((doc) => ({
    name: doc.name,
    brand: doc.brand,
    storeName: doc.storeName,
    price: doc.price,
    unit: doc.unit,
    normalizedUnit: doc.normalizedUnit,
    lastUpdated: doc.lastUpdated,
  }));
}
