import mongoose from "mongoose";
import { upcKey } from "../catalog/normalize";
import { CatalogDemand } from "./models";

/** How long a saved list line or a search keeps its place at the front of the lookup queue. */
export const CATALOG_DEMAND_DAYS = 30;

const STOP_WORDS = new Set(["a", "an", "the", "and", "or", "of", "for", "to", "with"]);

/** Grocery line or search box text, lowercased, with a leading quantity removed. */
export function demandText(raw: string | undefined | null): string | null {
  const text = (raw ?? "")
    .replace(/^\d+\s*x\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 80);
  if (text.length < 3 || STOP_WORDS.has(text) || text.startsWith("upc:")) {
    return null;
  }
  return text;
}

function rememberKey(keys: Set<string>, value: string | undefined): void {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return;
  }
  const fromCatalog = raw.startsWith("upc:") ? raw.slice(4).trim() : raw;
  if (!fromCatalog || fromCatalog.startsWith("local:")) {
    return;
  }
  const key = upcKey(fromCatalog) ?? (/^\d{6,14}$/.test(fromCatalog) ? fromCatalog : null);
  if (key) {
    keys.add(key);
  }
}

/**
 * Remember what shoppers asked for so cross-store lookup tries those
 * products before the rest of the aisle. Failures are swallowed: a demand
 * write must not break browse or trip planning.
 */
export async function noteCatalogDemand(input: {
  kind: "list" | "search";
  lines?: Array<string | undefined>;
  upcs?: Array<string | undefined>;
  catalogIds?: Array<string | undefined>;
}): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    return;
  }
  const texts = new Set<string>();
  for (const line of input.lines ?? []) {
    const text = demandText(line);
    if (text) {
      texts.add(text);
    }
  }
  const keys = new Set<string>();
  for (const upc of input.upcs ?? []) {
    rememberKey(keys, upc);
  }
  for (const id of input.catalogIds ?? []) {
    rememberKey(keys, id);
  }
  if (texts.size === 0 && keys.size === 0) {
    return;
  }
  const now = new Date();
  try {
    for (const text of texts) {
      await CatalogDemand.updateOne(
        { kind: input.kind, text },
        { $inc: { hits: 1 }, $set: { lastSeenAt: now }, $setOnInsert: { kind: input.kind, text } },
        { upsert: true }
      );
    }
    for (const key of keys) {
      const text = `upc:${key}`;
      await CatalogDemand.updateOne(
        { kind: input.kind, text },
        {
          $inc: { hits: 1 },
          $set: { lastSeenAt: now, upcKey: key },
          $setOnInsert: { kind: input.kind, text },
        },
        { upsert: true }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Catalog demand note failed: ${message}`);
  }
}
