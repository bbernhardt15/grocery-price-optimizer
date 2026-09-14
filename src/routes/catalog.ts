import { Router, Request, Response } from "express";
import { seedCatalog } from "../seedProducts";
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

function demoSearch(query: string): FatSecretProduct[] {
  const needle = query.trim().toLowerCase();
  return DEMO_PRODUCTS.filter(
    (product) =>
      product.name.toLowerCase().includes(needle) ||
      product.brand.toLowerCase().includes(needle)
  ).slice(0, 12);
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

  try {
    const products = await fatSecretService.searchGlobalCatalog(query);
    res.json(products);
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
