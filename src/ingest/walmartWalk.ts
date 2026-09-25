import { mapToDepartment } from "../catalog/departments";
import type { RawCatalogRecord } from "../catalog/types";

/**
 * Walmart Affiliate Catalog Product (paginated items).
 *
 * Docs checked 2026-09-25:
 * - Taxonomy: GET /taxonomy → `{ categories: [{ id, name, path, children }] }`
 *   https://walmart.io/apidocs/affiliates/taxonomy
 * - Catalog Product: GET /paginated/items?category=&count=
 *   Response fields used by the official wrapper and the Catalog Product doc:
 *   `items`, `nextPage`, `nextPageExist`, `totalPages`.
 *   The next request passes `nextPage` (a URL or a cursor embedded in that URL).
 *   https://walmart.io/docs/affiliate/paginated-items
 * - `count` is a documented request parameter. Search documents `numItems` max 25,
 *   and paginated examples use 10–25, so each page asks for 25.
 *
 * The public Affiliate introduction does not publish a numeric daily quota
 * (the Marketplace rate-limit tables are a different API). HTTP 429 is the
 * throttle signal. Budgets live in config.ts.
 */

export const WALMART_PAGE_COUNT = 25;

export type WalmartCategory = {
  id: string;
  name: string;
  path: string;
  departmentId: string;
};

type Taxon = {
  id: string;
  name: string;
  path: string;
  children: Taxon[];
};

const GROCERY_PATH =
  /grocery|food|produce|dairy|meat|seafood|bakery|deli|frozen|snack|beverage|breakfast|cereal|baby|household|cleaning|paper|personal|beauty|health|pet|pantry|coffee|juice/i;

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

export function flattenTaxonomy(value: unknown, parentPath = ""): Taxon[] {
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
    const path = String(record.path ?? "").trim() || (parentPath ? `${parentPath}/${name}` : name);
    const children = flattenTaxonomy(record.children ?? record.categories ?? [], path);
    nodes.push({ id, name, path, children });
  }
  return nodes;
}

function isGrocery(node: Taxon): boolean {
  const mapped = mapToDepartment([node.path, node.name], node.name);
  if (mapped.departmentId !== "other") {
    return true;
  }
  return GROCERY_PATH.test(`${node.path} ${node.name}`);
}

function leavesOf(nodes: Taxon[], out: Taxon[] = []): Taxon[] {
  for (const node of nodes) {
    if (node.children.length === 0) {
      out.push(node);
    } else {
      leavesOf(node.children, out);
    }
  }
  return out;
}

/** Leaf categories that belong on a grocery shelf. Parents are not paged. */
export function groceryLeaves(taxonomy: unknown): WalmartCategory[] {
  const leaves = leavesOf(flattenTaxonomy(taxonomy)).filter((node) => isGrocery(node));
  const seen = new Set<string>();
  const categories: WalmartCategory[] = [];
  for (const node of leaves) {
    if (seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    const mapped = mapToDepartment([node.path, node.name], node.name);
    categories.push({
      id: node.id,
      name: node.name,
      path: node.path,
      departmentId: mapped.departmentId === "other" ? "pantry" : mapped.departmentId,
    });
  }
  return categories;
}

export function walmartPagePath(categoryId: string, nextPage: string | null | undefined): string {
  const cursor = nextPage?.trim();
  if (!cursor) {
    return `/paginated/items?category=${encodeURIComponent(categoryId)}&count=${WALMART_PAGE_COUNT}`;
  }
  if (cursor.startsWith("http://") || cursor.startsWith("https://")) {
    const url = new URL(cursor);
    const marker = "/paginated/items";
    const index = url.pathname.indexOf(marker);
    const path = index >= 0 ? url.pathname.slice(index) : marker;
    return `${path}${url.search}`;
  }
  if (cursor.startsWith("/")) {
    return cursor;
  }
  return `/paginated/items?category=${encodeURIComponent(categoryId)}&count=${WALMART_PAGE_COUNT}&nextPage=${encodeURIComponent(cursor)}`;
}

export function walmartNextCursor(payload: unknown): string | null {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  if (record.nextPageExist === false) {
    return null;
  }
  const next = record.nextPage ?? record.nextPageUrl;
  if (typeof next !== "string" || !next.trim()) {
    return null;
  }
  return next.trim();
}

function itemList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const record = asRecord(payload);
  return Array.isArray(record?.items) ? (record.items as unknown[]) : [];
}

export function recordsFromWalmartPage(payload: unknown, category?: WalmartCategory): RawCatalogRecord[] {
  const records: RawCatalogRecord[] = [];
  for (const entry of itemList(payload)) {
    const item = asRecord(entry);
    if (!item) {
      continue;
    }
    const name = String(item.name ?? "").trim();
    const sale = typeof item.salePrice === "number" ? item.salePrice : null;
    const msrp = typeof item.msrp === "number" ? item.msrp : null;
    const price = sale !== null && sale >= 0 ? sale : msrp !== null && msrp >= 0 ? msrp : null;
    if (!name || price === null) {
      continue;
    }
    const images = [item.largeImage, item.mediumImage, item.thumbnailImage]
      .map((url) => (typeof url === "string" ? url.trim() : ""))
      .filter(Boolean);
    const categories = [item.categoryPath, item.categoryNode, category?.path]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean);
    const stock = typeof item.stock === "string" ? item.stock.toLowerCase() : "";
    const itemId = item.itemId != null ? String(item.itemId).trim() : "";
    const upc = typeof item.upc === "string" ? item.upc.trim() : "";
    const productUrl = typeof item.productUrl === "string" ? item.productUrl.trim() : "";
    records.push({
      name,
      brand: String(item.brandName ?? item.brand ?? "Walmart").trim() || "Walmart",
      storeName: "Walmart",
      price,
      priceSource: "live",
      ...(upc ? { upc } : {}),
      ...(itemId ? { productId: itemId, retailerItemId: itemId } : {}),
      ...(typeof item.size === "string" && item.size.trim() ? { size: item.size.trim() } : {}),
      ...(images.length > 0 ? { imageUrls: images } : {}),
      ...(categories.length > 0 ? { categories } : {}),
      ...(category ? { departmentId: category.departmentId } : {}),
      ...(msrp !== null && sale !== null && msrp > sale ? { onSale: true } : {}),
      availability: !stock ? "unknown" : stock.includes("not") || stock.includes("out") ? "out_of_stock" : "in_stock",
      ...(productUrl ? { productUrl } : {}),
    });
  }
  return records;
}
