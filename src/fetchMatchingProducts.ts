import { Product } from "./models/Product";
import { escapeRegex } from "./escapeRegex";
import { parseGroceryList } from "./parseGroceryLine";
import type { CatalogProduct } from "./optimizeGroceryList";

type LeanProduct = {
  _id: { toString(): string };
  name: string;
  brand: string;
  storeName: string;
  locationId?: string;
  price: number;
  unit: string;
  normalizedUnit: string;
  lastUpdated?: Date;
};

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

function locationFilter(locationId?: string): Record<string, unknown> | null {
  const id = locationId?.trim();
  if (!id) {
    return null;
  }

  return { locationId: id };
}

function toCatalogProduct(doc: LeanProduct): CatalogProduct {
  return {
    name: doc.name,
    brand: doc.brand,
    storeName: doc.storeName,
    locationId: doc.locationId,
    price: doc.price,
    unit: doc.unit,
    normalizedUnit: doc.normalizedUnit,
    lastUpdated: doc.lastUpdated,
  };
}

/**
 * For each grocery-list string, strips any quantity then finds Product
 * documents whose name contains that string (case-insensitive $regex).
 * Hits are sorted by price ascending so the cheapest variations come first.
 * When `locationId` is set, only products from that physical store are returned.
 */
export async function fetchMatchingProducts(
  groceryList: string[],
  stores: string[] = [],
  locationId?: string
): Promise<CatalogProduct[]> {
  const items = parseGroceryList(groceryList).map((line) => line.name);
  if (items.length === 0) {
    return [];
  }

  const extraClauses = [storeFilter(stores), locationFilter(locationId)].filter(
    (clause): clause is Record<string, unknown> => clause !== null
  );

  const batches = await Promise.all(
    items.map(async (item) => {
      const nameQuery = {
        name: { $regex: escapeRegex(item), $options: "i" },
      };
      const filter =
        extraClauses.length === 0
          ? nameQuery
          : { $and: [nameQuery, ...extraClauses] };

      return Product.find(filter).sort({ price: 1 }).lean<LeanProduct[]>();
    })
  );

  const seen = new Set<string>();
  const products: CatalogProduct[] = [];

  for (const docs of batches) {
    for (const doc of docs) {
      const id = doc._id.toString();
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      products.push(toCatalogProduct(doc));
    }
  }

  products.sort((a, b) => a.price - b.price);
  return products;
}
