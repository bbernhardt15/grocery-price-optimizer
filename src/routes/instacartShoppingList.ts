import { Router, Request } from "express";
import {
  InstacartRequestError,
  createInstacartShoppingList,
  isInstacartHandoffEnabled,
  sanitizeLinkback,
  type InstacartLineInput,
} from "../instacartHandoff";

const router = Router();
const MAX_ITEMS = 80;

router.get("/instacart/status", (_req, res) => {
  res.json({ enabled: isInstacartHandoffEnabled() });
});

router.post("/instacart/shopping-list", async (req, res) => {
  const parsed = parseShoppingListBody(req.body);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    const result = await createInstacartShoppingList({
      items: parsed.items,
      storeName: parsed.storeName,
      postalCode: parsed.postalCode,
      partnerLinkbackUrl: linkbackFromRequest(req),
    });
    res.json({
      productsLinkUrl: result.productsLinkUrl,
      retailerKey: result.retailerKey,
      retailerPreselected: result.retailerPreselected,
      retailerNote: result.retailerNote,
    });
  } catch (error) {
    if (error instanceof InstacartRequestError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Instacart shopping list failed.";
    res.status(502).json({
      error: message.includes("INSTACART_API_KEY")
        ? message
        : "Instacart shopping list failed. Try again shortly.",
    });
  }
});

function parseShoppingListBody(body: unknown):
  | { items: InstacartLineInput[]; storeName?: string; postalCode?: string }
  | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Body must be a JSON object with items[]." };
  }

  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.items) || record.items.length === 0) {
    return { error: "Send items[] with at least one product name." };
  }
  if (record.items.length > MAX_ITEMS) {
    return { error: `Instacart shopping lists are limited to ${MAX_ITEMS} items.` };
  }

  const items: InstacartLineInput[] = [];
  for (const entry of record.items) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) {
      continue;
    }
    const quantity = readQuantity(item.quantity);
    const unit = typeof item.unit === "string" ? item.unit.trim().slice(0, 40) : "";
    const size = typeof item.size === "string" ? item.size.trim().slice(0, 80) : "";
    const brand = typeof item.brand === "string" ? item.brand.trim().slice(0, 80) : "";
    const upc = typeof item.upc === "string" ? item.upc.trim().slice(0, 20) : "";
    items.push({
      name: name.slice(0, 200),
      quantity,
      ...(unit ? { unit } : {}),
      ...(size ? { size } : {}),
      ...(brand ? { brand } : {}),
      ...(upc ? { upc } : {}),
    });
  }

  if (items.length === 0) {
    return { error: "Each item needs a product name." };
  }

  const storeName =
    typeof record.storeName === "string" ? record.storeName.trim().slice(0, 80) : "";
  const postalCode =
    typeof record.postalCode === "string" ? record.postalCode.trim().slice(0, 10) : "";

  return {
    items,
    ...(storeName ? { storeName } : {}),
    ...(postalCode ? { postalCode } : {}),
  };
}

function readQuantity(value: unknown): number {
  const quantity = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 1;
  }
  return Math.min(quantity, 99);
}

function linkbackFromRequest(req: Request): string | undefined {
  const hostHeader = req.get("x-forwarded-host") || req.get("host");
  const host = hostHeader?.split(",")[0]?.trim() ?? "";
  if (!host || /[\s/]/.test(host)) {
    return undefined;
  }
  const protoHeader = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.protocol;
  if (protoHeader !== "https" && protoHeader !== "http") {
    return undefined;
  }
  return sanitizeLinkback(`${protoHeader}://${host}/`);
}

export default router;
