import { Router, Request, Response } from "express";
import { DEPARTMENTS } from "../catalog/departments";
import {
  browseCatalog,
  coverageFlags,
  getBrowseProduct,
  suggestCatalog,
} from "../catalog/service";
import { catalogCoverage } from "../catalog/coverage";
import type { BrowseSort, SizeClass } from "../catalog/types";
import { noteShopperZip } from "../ingest/runner";

const router = Router();

const SORTS = new Set<BrowseSort>(["relevance", "price", "unitPrice", "name", "onSale"]);
const SIZE_CLASSES = new Set<SizeClass>(["any", "small", "standard", "bulk"]);

function readZip(value: unknown): string | undefined | "invalid" {
  if (value === undefined || value === "") {
    return undefined;
  }
  const zip = String(value).trim();
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) {
    return "invalid";
  }
  return zip.slice(0, 5);
}

function readNumber(value: unknown): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function flag(value: unknown): boolean {
  return value === true || value === "1" || value === "true" || value === "on";
}

const DEPT_COLORS: Record<string, string> = {
  produce: "#2f7d45",
  "dairy-eggs": "#1f6f8a",
  "meat-seafood": "#9a3b3b",
  bakery: "#b86a2d",
  deli: "#8a4b2f",
  pantry: "#8a6a2b",
  frozen: "#3d6f9a",
  snacks: "#b45309",
  beverages: "#0f766e",
  breakfast: "#a16207",
  baby: "#7c5cbf",
  household: "#3f6212",
  "personal-care": "#9d174d",
  pet: "#57534e",
  other: "#57534e",
};

router.get("/catalog/departments", (_req, res) => {
  res.json({
    departments: DEPARTMENTS.map((department) => ({
      id: department.id,
      name: department.name,
      subcategories: department.subcategories,
    })),
  });
});

router.get("/catalog/coverage", (_req, res) => {
  res.json({ stores: catalogCoverage(coverageFlags()) });
});

router.get("/catalog/placeholder.svg", (req, res) => {
  const departmentId = String(req.query.d ?? "other");
  const title = String(req.query.t ?? "Grocery")
    .replace(/[<>&"]/g, "")
    .slice(0, 22);
  const color = DEPT_COLORS[departmentId] ?? DEPT_COLORS.other;
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join("");
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" role="img" aria-label="${title}">
  <rect width="320" height="240" rx="28" fill="${color}"/>
  <circle cx="160" cy="104" r="48" fill="rgba(255,253,248,0.16)"/>
  <text x="160" y="118" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="36" font-weight="700" fill="#fffdf8">${initials}</text>
  <text x="160" y="186" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="20" fill="#fffdf8">${title}</text>
</svg>`);
});

router.get("/catalog/suggest", async (req, res) => {
  const query = String(req.query.q ?? req.query.query ?? "").trim();
  if (!query) {
    res.json({ suggestions: [] });
    return;
  }
  const limit = readNumber(req.query.limit) ?? 8;
  const suggestions = await suggestCatalog(query, limit);
  res.json({
    suggestions: suggestions.map((product) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      departmentId: product.departmentId,
      departmentName: product.departmentName,
      sizeLabel: product.sizeLabel,
      imageUrl: product.imageUrls[0],
      bestPrice: product.bestOffer.price,
      bestStore: product.bestOffer.storeName,
      storeBrand: product.storeBrand,
    })),
  });
});

router.get("/catalog/browse", async (req, res) => {
  const zipCode = readZip(req.query.zip ?? req.query.zipCode);
  if (zipCode === "invalid") {
    res.status(400).json({ error: "zipCode must be a 5-digit ZIP, optionally with a +4 extension." });
    return;
  }
  if (zipCode) {
    void noteShopperZip(zipCode).catch(() => undefined);
  }
  const sortRaw = String(req.query.sort ?? "");
  const sizeRaw = String(req.query.size ?? req.query.sizeClass ?? "");
  try {
    const page = await browseCatalog({
      ...(req.query.q || req.query.query ? { query: String(req.query.q ?? req.query.query) } : {}),
      ...(req.query.department ? { departmentId: String(req.query.department) } : {}),
      ...(req.query.subcategory ? { subcategory: String(req.query.subcategory) } : {}),
      ...(req.query.store ? { store: String(req.query.store) } : {}),
      ...(req.query.brand ? { brand: String(req.query.brand) } : {}),
      ...(flag(req.query.onSale) ? { onSale: true } : {}),
      ...(flag(req.query.storeBrand) ? { storeBrand: true } : {}),
      ...(readNumber(req.query.minPrice) !== undefined ? { minPrice: readNumber(req.query.minPrice) } : {}),
      ...(readNumber(req.query.maxPrice) !== undefined ? { maxPrice: readNumber(req.query.maxPrice) } : {}),
      ...(SIZE_CLASSES.has(sizeRaw as SizeClass) ? { sizeClass: sizeRaw as SizeClass } : {}),
      ...(SORTS.has(sortRaw as BrowseSort) ? { sort: sortRaw as BrowseSort } : {}),
      ...(readNumber(req.query.limit) !== undefined ? { limit: readNumber(req.query.limit) } : {}),
      ...(req.query.cursor ? { cursor: String(req.query.cursor) } : {}),
      ...(zipCode ? { zipCode } : {}),
    });
    res.json(page);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Catalog browse failed: ${message}` });
  }
});

router.get("/catalog/products/:id", async (req, res) => {
  const product = await getBrowseProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: "Product not found in the catalog." });
    return;
  }
  res.json({ product });
});

export default router;
