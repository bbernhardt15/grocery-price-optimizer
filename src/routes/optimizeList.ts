import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { krogerService } from "../krogerService";
import { optimizeGroceryList } from "../optimizeGroceryList";
import { resolveCatalogProducts } from "../priceCache";

const router = Router();

type OptimizeListRequest = {
  groceryList: string[];
  stores: string[];
  zipCode?: string;
};

type VerifiedProduct = {
  name: string;
  quantity: number;
  brand?: string;
  foodId?: string;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function quantityOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Math.max(1, Number.parseInt(value.trim(), 10));
  }
  return 1;
}

function isVerifiedProduct(value: unknown): value is VerifiedProduct {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && record.name.trim().length > 0;
}

function isVerifiedProductArray(value: unknown): value is VerifiedProduct[] {
  return Array.isArray(value) && value.length > 0 && value.every(isVerifiedProduct);
}

function toGroceryStrings(items: VerifiedProduct[]): string[] {
  return items.map((item) => {
    const quantity = quantityOf(item.quantity);
    const name = item.name.trim();
    return `${quantity}x ${name}`;
  });
}

function readZipCode(value: unknown): string | undefined | "invalid" {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const zip = String(Math.trunc(value));
    return zip.length > 0 ? zip : "invalid";
  }

  if (typeof value !== "string") {
    return "invalid";
  }

  const zip = value.trim();
  return zip.length > 0 ? zip : "invalid";
}

function parseOptimizeListBody(body: unknown): OptimizeListRequest | null | "invalid-zip" {
  if (isStringArray(body)) {
    return { groceryList: body, stores: [] };
  }

  if (body === null || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  const rawList = record.groceryList ?? record.items;

  let groceryList: string[];
  if (isStringArray(rawList)) {
    groceryList = rawList;
  } else if (isVerifiedProductArray(rawList)) {
    groceryList = toGroceryStrings(rawList);
  } else {
    return null;
  }

  const zipCode = readZipCode(record.zipCode);
  if (zipCode === "invalid") {
    return "invalid-zip";
  }

  if (record.stores === undefined) {
    return { groceryList, stores: [], zipCode };
  }

  if (!isStringArray(record.stores)) {
    return null;
  }

  return { groceryList, stores: record.stores, zipCode };
}

router.post("/optimize-list", async (req: Request, res: Response) => {
  const parsed = parseOptimizeListBody(req.body);

  if (parsed === "invalid-zip") {
    res.status(400).json({
      error: "zipCode must be a 5-digit ZIP, optionally with a +4 extension.",
    });
    return;
  }

  if (parsed === null) {
    res.status(400).json({
      error:
        "Request body must be an array of grocery strings, or an object with groceryList/items as strings or verified product objects.",
    });
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    res.status(503).json({
      error:
        "Database is not connected. Set MONGO_URL or MONGODB_URI, or wait for the in-memory MongoDB to start.",
    });
    return;
  }

  try {
    const { groceryList, stores, zipCode } = parsed;

    let locationId: string | undefined;
    if (zipCode) {
      locationId = await krogerService.getClosestStoreLocation(zipCode);
    }

    const productsResult = await resolveCatalogProducts(
      groceryList,
      stores,
      locationId
    );
    const groupedByStore = optimizeGroceryList(
      groceryList,
      stores,
      productsResult.products
    );

    if (
      groupedByStore.stores.length === 0 &&
      groupedByStore.unavailable.length > 0 &&
      productsResult.pricingError
    ) {
      res.status(503).json({
        error: `Live store prices are unavailable: ${productsResult.pricingError}`,
        unavailable: groupedByStore.unavailable,
        ...(zipCode ? { zipCode, locationId } : {}),
      });
      return;
    }

    res.json({
      ...groupedByStore,
      ...(productsResult.pricingError
        ? { pricingWarning: productsResult.pricingError }
        : {}),
      ...(zipCode ? { zipCode, locationId } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Invalid ZIP code:")) {
      res.status(400).json({ error: message });
      return;
    }

    res.status(500).json({ error: `Failed to optimize list: ${message}` });
  }
});

export default router;
