import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { fetchMatchingProducts } from "../fetchMatchingProducts";
import { optimizeGroceryList } from "../optimizeGroceryList";

const router = Router();

type OptimizeListRequest = {
  groceryList: string[];
  stores: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseOptimizeListBody(body: unknown): OptimizeListRequest | null {
  if (isStringArray(body)) {
    return { groceryList: body, stores: [] };
  }

  if (body === null || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  const groceryList = record.groceryList ?? record.items;

  if (!isStringArray(groceryList)) {
    return null;
  }

  if (record.stores === undefined) {
    return { groceryList, stores: [] };
  }

  if (!isStringArray(record.stores)) {
    return null;
  }

  return { groceryList, stores: record.stores };
}

router.post("/optimize-list", async (req: Request, res: Response) => {
  const parsed = parseOptimizeListBody(req.body);

  if (parsed === null) {
    res.status(400).json({
      error:
        "Request body must be an array of grocery strings, or an object with a groceryList (or items) string array.",
    });
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      error:
        "Database is not connected. Set MONGODB_URI or wait for the in-memory MongoDB to start.",
    });
    return;
  }

  try {
    const { groceryList, stores } = parsed;

    // Case-insensitive contains match per grocery string, cheapest variations first.
    const products = await fetchMatchingProducts(groceryList, stores);
    const groupedByStore = optimizeGroceryList(groceryList, stores, products);

    res.json(groupedByStore);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to optimize list: ${message}` });
  }
});

export default router;
