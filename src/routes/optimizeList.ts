import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { isKrogerCartOAuthConfigured } from "../krogerCartAuth";
import { krogerService, krogerStoreNote } from "../krogerService";
import { optimizeGroceryList } from "../optimizeGroceryList";
import { resolveCatalogProducts } from "../priceCache";
import { walmartPricingProvider } from "../pricing/walmartProvider";
import type { WalmartNearbyStore } from "../pricing/walmartProvider";
import { enrichOptimizeResult } from "../storeHandoff";
import { loadKnownProducts } from "../catalog/service";
import { pinnedRowsForSelections, type BrowseSelection } from "../catalog/pinSelections";
import { noteCatalogDemand } from "../ingest/demand";
import { noteShopperZip } from "../ingest/runner";
import { accessFor } from "../billing/access";
import { entitlementPayload, lockCartHandoffs } from "../billing/applyPlan";
import { withDeadline } from "../withDeadline";

/** Nearby-store lookups must not hold the whole plan. Prices still return. */
const STORE_LOOKUP_MS = 3000;

const router = Router();

type OptimizeListRequest = {
  groceryList: string[];
  stores: string[];
  zipCode?: string;
  allowSubstitutes?: boolean;
  selections?: BrowseSelection[];
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

function readSelections(value: unknown): BrowseSelection[] | undefined {
  if (!isVerifiedProductArray(value)) {
    return undefined;
  }
  return value.map((item) => {
    const record = item as VerifiedProduct & {
      catalogId?: unknown;
      upc?: unknown;
      brand?: unknown;
      preferenceMode?: unknown;
      family?: unknown;
      brands?: unknown;
    };
    const brand = typeof record.brand === "string" ? record.brand.trim() : undefined;
    const catalogId = typeof record.catalogId === "string" ? record.catalogId.trim() : undefined;
    const upc = typeof record.upc === "string" ? record.upc.trim() : undefined;
    const preferenceMode = typeof record.preferenceMode === "string" ? record.preferenceMode.trim() : undefined;
    const family = typeof record.family === "string" ? record.family.trim() : undefined;
    const brands = Array.isArray(record.brands)
      ? record.brands
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim())
          .slice(0, 12)
      : undefined;
    return {
      name: item.name.trim(),
      quantity: quantityOf(item.quantity),
      ...(brand ? { brand } : {}),
      ...(catalogId ? { catalogId } : {}),
      ...(upc ? { upc } : {}),
      ...(preferenceMode ? { preferenceMode } : {}),
      ...(family ? { family } : {}),
      ...(brands?.length ? { brands } : {}),
    };
  });
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

  const selections = readSelections(rawList);
  const allowSubstitutes = record.allowSubstitutes === true;
  const extras = {
    ...(allowSubstitutes ? { allowSubstitutes: true } : {}),
    ...(selections?.some((item) => item.catalogId || item.upc) ? { selections } : {}),
  };

  if (record.stores === undefined) {
    return { groceryList, stores: [], zipCode, ...extras };
  }

  if (!isStringArray(record.stores)) {
    return null;
  }

  return { groceryList, stores: record.stores, zipCode, ...extras };
}

function tripIncludesWalmart(stores: string[]): boolean {
  if (stores.length === 0) {
    return true;
  }
  return stores.some((store) => store.trim().toLowerCase() === "walmart");
}

async function lookupWalmartStore(
  zipCode: string | undefined,
  stores: string[]
): Promise<WalmartNearbyStore | undefined> {
  if (!zipCode || !tripIncludesWalmart(stores) || !walmartPricingProvider.isConfigured()) {
    return undefined;
  }
  try {
    return await walmartPricingProvider.getNearestStore(zipCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : "lookup failed";
    console.warn(`Walmart store lookup failed: ${message}`);
    return undefined;
  }
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
    let storeNote = "";
    const walmartStorePromise = withDeadline(lookupWalmartStore(zipCode, stores), STORE_LOOKUP_MS, undefined);
    if (zipCode) {
      void noteShopperZip(zipCode).catch(() => undefined);
      const nearest = await withDeadline(krogerService.resolveClosestStore(zipCode), STORE_LOOKUP_MS, null);
      locationId = nearest?.locationId || undefined;
      storeNote = krogerStoreNote(nearest);
    }
    const upcByName = new Map<string, string>();
    for (const selection of parsed.selections || []) {
      if (selection.upc) upcByName.set(selection.name.toLowerCase(), selection.upc);
    }
    await noteCatalogDemand({
      kind: "list",
      lines: groceryList,
      upcs: parsed.selections?.map((item) => item.upc),
      catalogIds: parsed.selections?.map((item) => item.catalogId),
    });

    const stream = String(req.headers.accept || "").toLowerCase().includes("application/x-ndjson");
    if (stream) {
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.flushHeaders?.();
    }
    const writeEvent = (value: unknown) => {
      if (stream) res.write(`${JSON.stringify(value)}\n`);
    };
    const productsResult = await resolveCatalogProducts(groceryList, stores, locationId, zipCode, {
      onStore: (info) => {
        writeEvent({
          type: "status",
          storeName: info.storeName,
          ms: info.ms,
          pendingStores: info.pendingStores,
        });
      },
      ...(upcByName.size ? { upcByName } : {}),
    });
    const krogerUnpriced =
      productsResult.pricingByStore.find((report) => report.storeName.trim().toLowerCase() === "kroger")?.unpricedItems ||
      [];
    if (parsed.selections && parsed.selections.length > 0) {
      const pool = await loadKnownProducts({
        queries: [...groceryList, ...parsed.selections.map((item) => item.name)],
      });
      const pinned = pinnedRowsForSelections(pool.length ? parsed.selections : [], pool, {
        allowSubstitutes: parsed.allowSubstitutes === true,
      });
      productsResult.products.push(...pinned);
    }
    const walmartStore = await walmartStorePromise;
    const access = await accessFor(res);
    let groupedByStore = enrichOptimizeResult(
      optimizeGroceryList(groceryList, stores, productsResult.products, access.limits.multiStore ? "split" : "single"),
      {
        krogerCartOAuthConfigured: isKrogerCartOAuthConfigured(),
        pricingByStore: productsResult.pricingByStore,
        ...(walmartStore ? { walmartStore } : {}),
      }
    );
    if (!access.limits.cartHandoffs) groupedByStore = lockCartHandoffs(groupedByStore);
    const entitlement = entitlementPayload(access);

    const payload = {
      ...groupedByStore,
      ...(entitlement ? { entitlement } : {}),
      pricingByStore: productsResult.pricingByStore,
      ...(productsResult.pricingError ? { pricingWarning: productsResult.pricingError } : {}),
      ...(productsResult.partial
        ? { partial: true, pendingStores: productsResult.pendingStores || [] }
        : {}),
      ...(zipCode ? { zipCode, locationId } : {}),
      ...(storeNote ? { krogerStoreNote: storeNote } : {}),
      ...(krogerUnpriced.length ? { krogerUnpriced } : {}),
    };

    if (
      groupedByStore.stores.length === 0 &&
      groupedByStore.unavailable.length > 0 &&
      productsResult.pricingError &&
      !productsResult.partial
    ) {
      if (stream) {
        writeEvent({ type: "error", error: `Live store prices are unavailable: ${productsResult.pricingError}` });
        res.end();
        return;
      }
      res.status(503).json({
        error: `Live store prices are unavailable: ${productsResult.pricingError}`,
        unavailable: groupedByStore.unavailable,
        tripPlan: groupedByStore.tripPlan,
        pricingByStore: productsResult.pricingByStore,
        ...(zipCode ? { zipCode, locationId } : {}),
      });
      return;
    }

    if (stream) {
      writeEvent({ type: "done", result: payload });
      res.end();
      return;
    }
    res.json(payload);
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
