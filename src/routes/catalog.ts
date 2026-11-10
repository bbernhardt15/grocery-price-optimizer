import { Router, Request, Response } from "express";
import { demoBrowseProducts } from "../catalog/demoCatalog";
import { spokenTranscriptAliases } from "../productSearchQuery";
import { seedCatalog } from "../seedProducts";
import { NOT_IN_SERVICE_AREA_CODE, PLAN_ZIP_ERROR, requirePlanZip } from "../serviceArea";
import {
  FatSecretService,
  type FatSecretProduct,
} from "../services/fatsecretService";

const router = Router();
const fatSecretService = new FatSecretService();

const DEMO_PRODUCTS: FatSecretProduct[] = uniqueDemoProducts();

function uniqueDemoProducts(): FatSecretProduct[] {
  const seen = new Set<string>();
  const products: FatSecretProduct[] = [];
  for (const product of seedCatalog) {
    const key = `${product.name}\0${product.brand}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    products.push({
      id: `demo-${key.replace(/[^a-z0-9]+/g, "-")}`,
      name: product.name,
      brand: product.brand,
    });
  }
  return products;
}

function loose(value: string): string {
  return spokenTranscriptAliases(value).toLowerCase().replace(/['’]/g, "");
}

function demoSearch(query: string): FatSecretProduct[] {
  const needle = loose(query).trim();
  if (!needle) return [];
  const seen = new Set<string>();
  const hits: FatSecretProduct[] = [];
  const consider = (name: string, brand: string, id: string) => {
    const key = `${name}\0${brand}`.toLowerCase();
    if (seen.has(key)) return;
    const blob = loose(`${brand} ${name}`);
    if (!blob.includes(needle) && !needle.split(/\s+/).every((part) => part && blob.includes(part))) return;
    seen.add(key);
    hits.push({ id, name, brand });
  };
  for (const product of DEMO_PRODUCTS) consider(product.name, product.brand, product.id);
  for (const product of demoBrowseProducts()) {
    consider(product.name, product.brand || "", product.id || `demo-${loose(product.name)}`);
  }
  return hits.slice(0, 12);
}

function readQuery(value: unknown): string {
  if (Array.isArray(value)) {
    return String(value[0] ?? "").trim();
  }
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}

router.get("/search-catalog", async (req: Request, res: Response) => {
  const query = readQuery(req.query.query);
  if (!query) {
    res.status(400).json({
      error: "Missing query parameter. Use /api/search-catalog?query=milk",
    });
    return;
  }
  const decision = requirePlanZip(req.query.zip ?? req.query.zipCode);
  if (!decision.ok) {
    res.status(decision.status).json({
      error: decision.status === 400 ? PLAN_ZIP_ERROR : decision.error,
      ...(decision.status === 422 ? { code: NOT_IN_SERVICE_AREA_CODE } : {}),
    });
    return;
  }

  try {
    const products = await fatSecretService.searchGlobalCatalog(spokenTranscriptAliases(query));
    const extra = demoSearch(query).filter((row) => !products.some((have) => loose(have.brand) === loose(row.brand) && loose(have.name) === loose(row.name)));
    res.json([...products, ...extra].slice(0, 24));
  } catch (error) {
    const message = errorMessage(error);
    console.error(`FatSecret catalog search failed: ${message}`);
    const fallback = demoSearch(query);
    if (fallback.length > 0) {
      res.json(fallback);
      return;
    }
    res.status(500).json({
      error: `Catalog search failed: ${message}`,
    });
  }
});

export { fatSecretService };
export default router;
