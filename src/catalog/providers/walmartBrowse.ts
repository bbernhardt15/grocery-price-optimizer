import type { CatalogProduct } from "../../optimizeGroceryList";
import { walmartPricingProvider } from "../../pricing/walmartProvider";
import { StorePricingError } from "../../pricing/types";
import { mapToDepartment } from "../departments";
import { searchTermsFor } from "../searchTerms";
import type { RawCatalogRecord } from "../types";
import { rawFromCatalogProduct } from "./fromCatalogProduct";

/**
 * Walmart Affiliate browse.
 *
 * Documented product host (same base as search):
 *   GET /taxonomy
 *   GET /paginated/items?category={id}&count=25
 *   GET /search?query=&categoryId=  (fallback)
 *
 * Taxonomy responses vary by app approval. This parser accepts a `categories`
 * tree or a bare array of `{ id, name, children }`. Paginated items is one
 * page only — not the full assortment. Prices stay walmart.com catalog prices.
 */

type Taxon = {
  id: string;
  name: string;
  path: string;
  children: Taxon[];
};

const TAXONOMY_TTL_MS = 24 * 60 * 60 * 1000;
let taxonomyCache: { expiresAt: number; nodes: Taxon[] } | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function childNodes(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  for (const key of ["categories", "category", "children"]) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[];
    }
  }
  return [];
}

function flattenTaxonomy(value: unknown, parentPath = ""): Taxon[] {
  const nodes: Taxon[] = [];
  for (const entry of childNodes(value)) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const id = String(record.id ?? record.categoryId ?? "").trim();
    const name = String(record.name ?? record.categoryName ?? "").trim();
    if (!id || !name) {
      continue;
    }
    const path = parentPath ? `${parentPath}/${name}` : name;
    const children = flattenTaxonomy(record.children ?? record.categories ?? [], path);
    nodes.push({ id, name, path, children });
    nodes.push(...children);
  }
  return nodes;
}

function itemsFromPayload(payload: unknown): CatalogProduct[] {
  const record = asRecord(payload);
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.items)
      ? record.items
      : [];
  const products: CatalogProduct[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      itemId?: number | string;
      name?: string;
      brandName?: string;
      salePrice?: number;
      msrp?: number;
      upc?: string;
      size?: string;
      thumbnailImage?: string;
      mediumImage?: string;
      largeImage?: string;
      categoryPath?: string;
      stock?: string;
    };
    const mapped = rawItemToProduct(row);
    if (mapped) {
      products.push(mapped);
    }
  }
  return products;
}

function rawItemToProduct(item: {
  itemId?: number | string;
  name?: string;
  brandName?: string;
  salePrice?: number;
  msrp?: number;
  upc?: string;
  size?: string;
  thumbnailImage?: string;
  mediumImage?: string;
  largeImage?: string;
  categoryPath?: string;
  stock?: string;
}): CatalogProduct | null {
  const name = item.name?.trim();
  const price =
    typeof item.salePrice === "number"
      ? item.salePrice
      : typeof item.msrp === "number"
        ? item.msrp
        : null;
  if (!name || price === null || price < 0) {
    return null;
  }
  const productId = item.itemId != null ? String(item.itemId).trim() : "";
  const images = [item.largeImage, item.mediumImage, item.thumbnailImage].filter(
    (url): url is string => Boolean(url?.trim())
  );
  const stock = item.stock?.trim().toLowerCase();
  return {
    name,
    brand: item.brandName?.trim() || "Walmart",
    storeName: "Walmart",
    price,
    unit: "count",
    normalizedUnit: "count",
    priceSource: "live",
    ...(productId ? { productId } : {}),
    ...(item.upc?.trim() ? { upc: item.upc.trim() } : {}),
    ...(item.size?.trim() ? { size: item.size.trim() } : {}),
    ...(images.length > 0 ? { imageUrls: images } : {}),
    ...(item.categoryPath?.trim() ? { categories: [item.categoryPath.trim()] } : {}),
    ...(typeof item.msrp === "number" && item.msrp > price ? { onSale: true } : {}),
    availability: !stock ? "unknown" : stock.includes("not") || stock.includes("out") ? "out_of_stock" : "in_stock",
  };
}

async function loadTaxonomy(): Promise<Taxon[]> {
  if (taxonomyCache && taxonomyCache.expiresAt > Date.now()) {
    return taxonomyCache.nodes;
  }
  try {
    const payload = await walmartPricingProvider.getJson("/taxonomy");
    const nodes = flattenTaxonomy(payload);
    taxonomyCache = { expiresAt: Date.now() + TAXONOMY_TTL_MS, nodes };
    return nodes;
  } catch (error) {
    if (error instanceof StorePricingError) {
      throw error;
    }
    return [];
  }
}

function categoryIdForDepartment(nodes: Taxon[], departmentId: string): string | undefined {
  const matches = nodes.filter((node) => {
    const mapped = mapToDepartment([node.path, node.name], node.name);
    return mapped.departmentId === departmentId;
  });
  matches.sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.name.length - b.name.length);
  return matches[0]?.id;
}

function toRecords(products: CatalogProduct[], departmentId?: string): RawCatalogRecord[] {
  const records: RawCatalogRecord[] = [];
  for (const product of products) {
    const raw = rawFromCatalogProduct(product, "live");
    if (!raw) {
      continue;
    }
    if (departmentId) {
      const mapped = mapToDepartment(raw.categories, raw.name);
      if (mapped.departmentId !== departmentId && mapped.departmentId !== "other") {
        continue;
      }
      if (mapped.departmentId === "other") {
        raw.departmentId = departmentId;
      }
    }
    records.push(raw);
  }
  return records;
}

export async function fetchWalmartDepartment(
  departmentId: string,
  zipCode?: string
): Promise<RawCatalogRecord[]> {
  if (!walmartPricingProvider.isConfigured()) {
    return [];
  }

  const nodes = await loadTaxonomy().catch(() => [] as Taxon[]);
  const categoryId = categoryIdForDepartment(nodes, departmentId);
  if (categoryId) {
    try {
      const payload = await walmartPricingProvider.getJson(
        `/paginated/items?category=${encodeURIComponent(categoryId)}&count=25`
      );
      const records = toRecords(itemsFromPayload(payload), departmentId);
      if (records.length > 0) {
        return records;
      }
    } catch (error) {
      if (!(error instanceof StorePricingError)) {
        throw error;
      }
    }
  }

  const records: RawCatalogRecord[] = [];
  for (const term of searchTermsFor(departmentId)) {
    const products = await walmartPricingProvider.searchProducts(term, { zipCode });
    records.push(...toRecords(products, departmentId));
  }
  return records;
}

export async function fetchWalmartSearch(query: string, zipCode?: string): Promise<RawCatalogRecord[]> {
  if (!walmartPricingProvider.isConfigured()) {
    return [];
  }
  const products = await walmartPricingProvider.searchProducts(query, { zipCode });
  return products
    .map((product) => rawFromCatalogProduct(product, "live"))
    .filter((row): row is RawCatalogRecord => row !== null);
}

export function clearWalmartTaxonomyCache(): void {
  taxonomyCache = null;
}
