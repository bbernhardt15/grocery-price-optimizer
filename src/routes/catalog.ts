import { Router, Request, Response } from "express";
import { FatSecretService } from "../services/fatsecretService";

const router = Router();
const fatSecretService = new FatSecretService();

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
    res.status(500).json({
      error: `Catalog search failed: ${message}`,
    });
  }
});

export { fatSecretService };
export default router;
