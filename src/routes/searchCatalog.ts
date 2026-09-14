import { Router, Request, Response } from "express";
import { seedCatalog } from "../seedProducts";
import {
  fatSecretService,
  type FatSecretProduct,
} from "../services/fatsecretService";

const router = Router();

const DEMO_PRODUCTS: FatSecretProduct[] = uniqueDemoProducts();

function uniqueDemoProducts(): FatSecretProduct[] {
  const seen = new Set<string>();
  const products: FatSecretProduct[] = [];
  for (const product of seedCatalog) {
    const key = product.name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    products.push({
      name: product.name,
      brand: product.brand,
      foodId: `demo-${key.replace(/[^a-z0-9]+/g, "-")}`,
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

router.get("/search-catalog", async (req: Request, res: Response) => {
  const query = readQuery(req.query.query);
  if (query.length < 2) {
    res.json({ products: [] });
    return;
  }

  try {
    const products = await fatSecretService.searchGlobalCatalog(query);
    res.json({ products });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`FatSecret catalog search unavailable (${message}); using demo catalog`);
    res.json({ products: demoSearch(query), source: "demo" });
  }
});

export default router;
