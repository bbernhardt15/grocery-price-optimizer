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
 *   Walmart often returns that link with the gateway prefix
 *   `/api-proxy/service/affil/product/v2`. The signed client already uses that
 *   base, so the crawler strips the prefix down to `/paginated/items` and
 *   keeps the query string. A link that is not that endpoint is rebuilt from
 *   the category id and the page cursor.
 *   https://walmart.io/docs/affiliate/paginated-items
 * - `count` is a documented request parameter. Search documents `numItems` max 25,
 *   and paginated examples use 10–25, so each page asks for 25.
 *
 * The public Affiliate introduction does not publish a numeric daily quota
 * (the Marketplace rate-limit tables are a different API). HTTP 429 is the
 * throttle signal. Production returned 429 near 660 calls with a 5 second
 * gap (2026-09-29) and near 1,137 calls with a 2 second gap (2026-09-25),
 * so the crawler default stays 500 and the env value is clamped at 1,500.
 * GET /items accepts up to 20 UPCs in one call (`upc` comma-separated, same
 * cap as `ids`). Budgets live in config.ts.
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
    const path = taxonomyPath(String(record.path ?? "").trim(), parentPath, name);
    const children = flattenTaxonomy(record.children ?? record.categories ?? [], path);
    nodes.push({ id, name, path, children });
  }
  return nodes;
}

/**
 * Walmart often sets `path` to the root ("Food") on every child. Prefer the
 * ancestry we walked so "Breakfast Foods/Cereal" is not collapsed to "Food".
 */
function taxonomyPath(reported: string, parentPath: string, name: string): string {
  const built = parentPath ? `${parentPath}/${name}` : name;
  if (!reported) {
    return built;
  }
  if (!parentPath) {
    return reported.includes(name) ? reported : `${reported}/${name}`;
  }
  const root = parentPath.split("/")[0] ?? reported;
  if (!reported.includes("/") || reported === root || reported === parentPath) {
    return built;
  }
  if (!reported.endsWith(`/${name}`) && reported !== name) {
    return `${reported}/${name}`;
  }
  return reported;
}

/** Bump when grocery leaves change so a resume re-reads the Walmart tree. */
export const WALMART_TAXONOMY_VERSION = 8;

/**
 * Crawl a leaf only when it maps to a grocery department.
 * General merchandise (jewelry, office, home improvement, electronics,
 * apparel, toys, pet accessories, health devices, and the rest of
 * Industrial & Scientific) stays out so the daily budget is not spent there.
 * Auto & Tires, tires, RV, outdoor/patio, and automotive chemicals stay out
 * too, including leaves named Cleaners or Degreasers. Those pages are not fetched.
 * Seasonal, costume, pet-apparel, party, and decor leaves do too, even when
 * they sit under a grocery ancestor such as Dairy, Eggs & Cheese.
 * A food leaf under Seasonal (Halloween candy, eggnog) still maps to its aisle.
 */
function isGrocery(node: Taxon): boolean {
  const mapped = mapToDepartment([node.path, node.name], node.name);
  if (mapped.signal === "excluded" || mapped.generalMerchandise) {
    return false;
  }
  return mapped.departmentId !== "other";
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
      departmentId: mapped.departmentId,
    });
  }
  return categories;
}

const PAGINATED_ITEMS = "/paginated/items";
const PAGE_CURSOR_KEYS = ["nextPage", "page", "offset", "cursor", "start"] as const;

export type WalmartPagePlan = {
  /** Path and query for the signed Affiliate GET. Always starts with `/paginated/items`. */
  path: string;
  /** True when the stored link was not usable and the path was rebuilt. */
  fallback: boolean;
  /** Empty when the stored cursor needed no rewrite. */
  note: string;
};

function firstWalmartPage(categoryId: string): string {
  return `${PAGINATED_ITEMS}?category=${encodeURIComponent(categoryId)}&count=${WALMART_PAGE_COUNT}`;
}

function parseWalmartLink(raw: string): URL | null {
  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw);
    }
    if (raw.startsWith("/")) {
      return new URL(raw, "https://developer.api.walmart.com");
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Map a nextPage URL or path onto `/paginated/items`, dropping
 * `/api-proxy/service/affil` and `/product/v2` so the signed client does not
 * append that prefix to a base that already contains it.
 * Returns null when the link is not the paginated-items endpoint or has no
 * query (the shape behind "No endpoint GET /api-proxy/service/affil/product/v2/paginated/items").
 */
function rewriteWalmartNextPage(categoryId: string, cursor: string): WalmartPagePlan | null {
  if (!cursor.includes("/") && !/^https?:\/\//i.test(cursor)) {
    return {
      path: `${PAGINATED_ITEMS}?category=${encodeURIComponent(categoryId)}&count=${WALMART_PAGE_COUNT}&nextPage=${encodeURIComponent(cursor)}`,
      fallback: false,
      note: "",
    };
  }
  const url = parseWalmartLink(cursor);
  if (!url) {
    return null;
  }
  const index = url.pathname.lastIndexOf(PAGINATED_ITEMS);
  if (index < 0 || url.pathname.slice(index) !== PAGINATED_ITEMS) {
    return null;
  }
  if ([...url.searchParams.keys()].length === 0) {
    return null;
  }
  let search = url.search;
  if (!url.searchParams.get("category") && !url.searchParams.get("categoryId")) {
    const params = new URLSearchParams(url.searchParams);
    params.set("category", categoryId);
    search = `?${params.toString()}`;
  }
  const path = `${PAGINATED_ITEMS}${search}`;
  if (path.includes("/api-proxy/") || !path.startsWith(`${PAGINATED_ITEMS}?`)) {
    return null;
  }
  const stripped = cursor.includes("api-proxy/service/affil");
  return {
    path,
    fallback: false,
    note: stripped
      ? "rewrote nextPage onto /paginated/items, dropping the /api-proxy/service/affil prefix"
      : "",
  };
}

/** Category id plus whatever page cursor the bad link still carried. */
function rebuildWalmartPage(categoryId: string, cursor: string): string {
  const params = new URLSearchParams();
  params.set("category", categoryId);
  params.set("count", String(WALMART_PAGE_COUNT));
  const url = parseWalmartLink(cursor);
  if (url) {
    for (const key of PAGE_CURSOR_KEYS) {
      const value = url.searchParams.get(key)?.trim();
      if (value) {
        params.set(key, value);
      }
    }
  } else if (!cursor.includes("/")) {
    params.set("nextPage", cursor);
  }
  return `${PAGINATED_ITEMS}?${params.toString()}`;
}

/**
 * Normalize Walmart's nextPage onto the Affiliate paginated-items path.
 * `forceFallback` rebuilds from the category id after a rejected link, so a
 * retry does not send the same bad URL.
 */
export function normalizeWalmartPage(
  categoryId: string,
  nextPage: string | null | undefined,
  options?: { forceFallback?: boolean }
): WalmartPagePlan {
  const cursor = nextPage?.trim() ?? "";
  if (!cursor) {
    return { path: firstWalmartPage(categoryId), fallback: false, note: "" };
  }
  if (!options?.forceFallback) {
    const rewritten = rewriteWalmartNextPage(categoryId, cursor);
    if (rewritten) {
      return rewritten;
    }
  }
  return {
    path: rebuildWalmartPage(categoryId, cursor),
    fallback: true,
    note: options?.forceFallback
      ? "retrying with /paginated/items rebuilt from the category id and page cursor"
      : "nextPage link looked wrong; rebuilt /paginated/items from the category id and page cursor",
  };
}

export function walmartPagePath(categoryId: string, nextPage: string | null | undefined): string {
  return normalizeWalmartPage(categoryId, nextPage).path;
}

/** Walmart's gateway text when a nextPage path is called without rewriting it. */
export function isWalmartEndpointMiss(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const body =
    error && typeof error === "object" && "body" in error && typeof (error as { body?: unknown }).body === "string"
      ? (error as { body: string }).body
      : "";
  return /no endpoint\s+GET\s+\/api-proxy\/service\/affil/i.test(`${message}\n${body}`);
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

/**
 * Paginated items sometimes send `upc` as a number, or the code on `gtin`
 * instead of `upc`. A missing code stays unset so the row is keyed
 * `local:walmart:{itemId}` and does not merge with a Kroger UPC.
 */
export function readWalmartUpc(item: Record<string, unknown>): string {
  for (const key of ["upc", "UPC", "gtin", "gtin14", "gtin13", "gtin12"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
  }
  return "";
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
    const upc = readWalmartUpc(item);
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
