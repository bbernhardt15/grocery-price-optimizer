import type { BrowseFilters, BrowseProduct, BrowseSort, SizeClass } from "./types";

export function sizeClassOf(product: BrowseProduct): SizeClass | "unknown" {
  const size = product.packageSize;
  if (!size) {
    return "unknown";
  }
  if (size.dimension === "volume") {
    if (size.amount < 16) return "small";
    if (size.amount >= 64) return "bulk";
    return "standard";
  }
  if (size.dimension === "weight") {
    if (size.amount < 8) return "small";
    if (size.amount >= 32) return "bulk";
    return "standard";
  }
  if (size.amount <= 1) return "small";
  if (size.amount >= 12) return "bulk";
  return "standard";
}

function haystack(product: BrowseProduct): string {
  return `${product.name} ${product.brand} ${product.departmentName} ${product.subcategory ?? ""}`.toLowerCase();
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function filterProducts(products: BrowseProduct[], filters: BrowseFilters): BrowseProduct[] {
  const tokens = queryTokens(filters.query ?? "");
  const departmentId = filters.departmentId?.trim().toLowerCase();
  const subcategory = filters.subcategory?.trim().toLowerCase();
  const store = filters.store?.trim().toLowerCase();
  const brand = filters.brand?.trim().toLowerCase();

  return products.filter((product) => {
    if (departmentId && departmentId !== "all" && product.departmentId !== departmentId) {
      return false;
    }
    if (subcategory && (product.subcategory ?? "").toLowerCase() !== subcategory) {
      return false;
    }
    if (store) {
      const offered = product.offers.some((offer) => offer.storeName.toLowerCase() === store);
      if (!offered) {
        return false;
      }
    }
    if (brand && product.brand.toLowerCase() !== brand) {
      return false;
    }
    if (filters.onSale && !product.offers.some((offer) => offer.onSale && (!store || offer.storeName.toLowerCase() === store))) {
      return false;
    }
    if (filters.storeBrand && !product.storeBrand) {
      return false;
    }
    const price = store
      ? product.offers.find((offer) => offer.storeName.toLowerCase() === store)?.price
      : product.bestOffer.price;
    if (price === undefined) {
      return false;
    }
    if (filters.minPrice !== undefined && price < filters.minPrice) {
      return false;
    }
    if (filters.maxPrice !== undefined && price > filters.maxPrice) {
      return false;
    }
    if (filters.sizeClass && filters.sizeClass !== "any" && sizeClassOf(product) !== filters.sizeClass) {
      return false;
    }
    if (tokens.length > 0) {
      const text = haystack(product);
      if (!tokens.every((token) => text.includes(token))) {
        return false;
      }
    }
    return true;
  });
}

function relevance(product: BrowseProduct, tokens: string[]): number {
  if (tokens.length === 0) {
    return 0;
  }
  const name = product.name.toLowerCase();
  const brand = product.brand.toLowerCase();
  let score = 0;
  if (tokens.every((token) => name.includes(token))) {
    score += 5;
  }
  if (name.startsWith(tokens[0] ?? "")) {
    score += 2;
  }
  if (tokens.some((token) => brand.includes(token))) {
    score += 1;
  }
  return score;
}

function unitPriceValue(product: BrowseProduct, store?: string): number {
  const offer = store
    ? product.offers.find((entry) => entry.storeName.toLowerCase() === store.toLowerCase())
    : product.bestOffer;
  if (!offer) {
    return Number.POSITIVE_INFINITY;
  }
  return offer.unitPrice ?? Number.POSITIVE_INFINITY;
}

function shelfPrice(product: BrowseProduct, store?: string): number {
  if (!store) {
    return product.bestOffer.price;
  }
  return (
    product.offers.find((offer) => offer.storeName.toLowerCase() === store.toLowerCase())?.price ??
    Number.POSITIVE_INFINITY
  );
}

export function sortProducts(
  products: BrowseProduct[],
  sort: BrowseSort,
  filters: BrowseFilters = {}
): BrowseProduct[] {
  const tokens = queryTokens(filters.query ?? "");
  const store = filters.store?.trim();
  const copy = [...products];
  copy.sort((a, b) => {
    if (sort === "name") {
      return a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand);
    }
    if (sort === "unitPrice") {
      return unitPriceValue(a, store) - unitPriceValue(b, store) || shelfPrice(a, store) - shelfPrice(b, store);
    }
    if (sort === "onSale") {
      const saleA = a.offers.some((offer) => offer.onSale) ? 0 : 1;
      const saleB = b.offers.some((offer) => offer.onSale) ? 0 : 1;
      return saleA - saleB || shelfPrice(a, store) - shelfPrice(b, store);
    }
    if (sort === "relevance") {
      const delta = relevance(b, tokens) - relevance(a, tokens);
      if (delta !== 0) {
        return delta;
      }
    }
    return shelfPrice(a, store) - shelfPrice(b, store) || a.name.localeCompare(b.name);
  });
  return copy;
}

export function paginateProducts<T>(
  products: T[],
  offset: number,
  limit: number
): { items: T[]; total: number; nextCursor: string | null } {
  const start = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const size = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 24;
  const items = products.slice(start, start + size);
  const next = start + size < products.length ? String(start + size) : null;
  return { items, total: products.length, nextCursor: next };
}

export type BrowseFacets = {
  brands: string[];
  stores: string[];
  subcategories: string[];
};

export function facetsFor(products: BrowseProduct[]): BrowseFacets {
  const brands = new Set<string>();
  const stores = new Set<string>();
  const subcategories = new Set<string>();
  for (const product of products) {
    if (product.brand.trim()) {
      brands.add(product.brand.trim());
    }
    if (product.subcategory) {
      subcategories.add(product.subcategory);
    }
    for (const offer of product.offers) {
      stores.add(offer.storeName);
    }
  }
  const sort = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b));
  return {
    brands: sort(brands),
    stores: sort(stores),
    subcategories: sort(subcategories),
  };
}
