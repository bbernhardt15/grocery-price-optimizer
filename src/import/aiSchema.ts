/**
 * Strict JSON from a model. Prices, stores, and extra fields are rejected
 * so a model cannot invent a shelf price or skip the catalog.
 */

import { upcForStorage } from "../catalog/normalize";
import type { ParsedImportItem } from "./parseImportText";

const NAME = /^[\p{L}\p{N}][\p{L}\p{N}&'’.,/+% -]{0,79}$/u;
const FORBIDDEN = new Set(["price", "cost", "store", "storeName", "url", "link", "sku"]);

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  couple: 2,
  few: 3,
  some: 1,
};

export type AiValidation =
  | { ok: true; items: ParsedImportItem[] }
  | { ok: false; reason: string };

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function quantityOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 99) return value;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (/^\d{1,2}$/.test(trimmed)) {
      const parsed = Number(trimmed);
      return parsed >= 1 && parsed <= 99 ? parsed : null;
    }
    const word = trimmed.replace(/^a\s+/, "").replace(/\s+of$/, "");
    return WORDS[word] ?? null;
  }
  return null;
}

export function validateAiItems(payload: unknown): AiValidation {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "not-object" };
  }
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).some((key) => FORBIDDEN.has(key))) return { ok: false, reason: "forbidden" };
  const rows = record.items;
  if (!Array.isArray(rows)) return { ok: false, reason: "items" };
  if (rows.length > 80) return { ok: false, reason: "too-many" };
  const items: ParsedImportItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return { ok: false, reason: "row" };
    const fields = row as Record<string, unknown>;
    if (Object.keys(fields).some((key) => FORBIDDEN.has(key))) return { ok: false, reason: "forbidden" };
    const name = text(fields.name, 80);
    if (!name || !NAME.test(name)) return { ok: false, reason: "name" };
    const quantity = quantityOf(fields.quantity ?? 1);
    if (!quantity) return { ok: false, reason: "quantity" };
    const brand = text(fields.brand, 80);
    const size = text(fields.size, 80);
    const notes = text(fields.notes, 80);
    const upc = upcForStorage(text(fields.upc, 20));
    items.push({
      raw: name,
      name,
      quantity,
      ...(brand ? { brand } : {}),
      ...(size ? { size } : {}),
      ...(notes ? { notes } : {}),
      ...(upc ? { upc } : {}),
    });
  }
  if (!items.length) return { ok: false, reason: "empty" };
  return { ok: true, items };
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() || trimmed;
  return JSON.parse(body);
}
