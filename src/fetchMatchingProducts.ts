import { Product } from "./models/Product";
import { escapeRegex } from "./escapeRegex";
import { parseGroceryList } from "./parseGroceryLine";
import type { CatalogProduct } from "./optimizeGroceryList";
import {
  keywordNameFilter,
  matchTokenSets,
} from "./productSearchQuery";

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
  updatedAt?: Date;
};

export type FetchMatchingOptions = {
  minUpdatedAt?: Date;
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
    updatedAt: doc.updatedAt,
  };
}

function matchingFilter(
  tokens: string[],
  stores: string[],
  locationId: string | undefined,
  options: FetchMatchingOptions
): Record<string, unknown> | null {
  const nameQuery = keywordNameFilter(tokens);
  if (!nameQuery) {
    return null;
  }
  const extraClauses = [storeFilter(stores), locationFilter(locationId)].filter(
    (clause): clause is Record<string, unknown> => clause !== null
  );
  if (options.minUpdatedAt) {
    extraClauses.push({ updatedAt: { $gte: options.minUpdatedAt } });
  }

  return extraClauses.length === 0
    ? nameQuery
    : { $and: [nameQuery, ...extraClauses] };
}

function uniqueCatalog(docs: LeanProduct[]): CatalogProduct[] {
  const seen = new Set<string>();
  const products: CatalogProduct[] = [];

  for (const doc of docs) {
    const id = doc._id.toString();
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    products.push(toCatalogProduct(doc));
  }

  products.sort((a, b) => a.price - b.price);
  return products;
}

async function findByTokens(
  tokens: string[],
  stores: string[],
  locationId: string | undefined,
  options: FetchMatchingOptions
): Promise<CatalogProduct[]> {
  const filter = matchingFilter(tokens, stores, locationId, options);
  if (!filter) {
    return [];
  }

  const docs = await Product.find(filter)
    .sort({ price: 1 })
    .lean<LeanProduct[]>();

  return uniqueCatalog(docs);
}

/**
 * Finds Product documents whose name contains each keyword from `item`
 * (case-insensitive $regex AND). Serving-size annotations like "(28g)" are
 * ignored. If nothing matches the full name, retries without generic trailing
 * words (Cereal) and then the first two words.
 * Hits are sorted by price ascending. When `locationId` is set, only that
 * physical store is returned. `minUpdatedAt` keeps only fresh cache rows.
 */
export async function fetchMatchingProductsForQuery(
  item: string,
  stores: string[] = [],
  locationId?: string,
  options: FetchMatchingOptions = {}
): Promise<CatalogProduct[]> {
  for (const tokens of matchTokenSets(item)) {
    const matches = await findByTokens(tokens, stores, locationId, options);
    if (matches.length > 0) {
      return matches.map((product) => ({ ...product, sourceQuery: item }));
    }
  }

  return [];
}

/**
 * For each grocery-list string, strips any quantity then finds Product
 * documents whose name contains those keywords (case-insensitive $regex).
 * Hits are sorted by price ascending so the cheapest variations come first.
 * When `locationId` is set, only products from that physical store are returned.
 */
export async function fetchMatchingProducts(
  groceryList: string[],
  stores: string[] = [],
  locationId?: string,
  options: FetchMatchingOptions = {}
): Promise<CatalogProduct[]> {
  const items = parseGroceryList(groceryList).map((line) => line.name);
  if (items.length === 0) {
    return [];
  }

  const batches = await Promise.all(
    items.map((item) =>
      fetchMatchingProductsForQuery(item, stores, locationId, options)
    )
  );

  const seen = new Set<string>();
  const products: CatalogProduct[] = [];

  for (const batch of batches) {
    for (const product of batch) {
      const key = `${product.storeName}|${product.locationId ?? ""}|${product.brand}|${product.name}|${product.price}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      products.push(product);
    }
  }

  products.sort((a, b) => a.price - b.price);
  return products;
}
