/**
 * Groceries visible in a fridge or pantry photo.
 * A row is kept only when its name maps to a staple family.
 * Nothing here suggests a meal, and nothing is written to disk.
 */

import { familyFromQuery, familyLabel, PREFERENCE_CATEGORIES } from "../catalog/stapleFamilies";
import { parseModelJson } from "./aiSchema";

export type ShelfFullness = "full" | "half" | "low" | "empty" | "unknown";
export type ShelfConfidence = "high" | "low";

export type ShelfItem = {
  name: string;
  family: string;
  label: string;
  confidence: ShelfConfidence;
  fullness: ShelfFullness;
  unsure: boolean;
};

const HEDGE = /\b(?:maybe|perhaps|possibly|unsure|unclear|unknown|guess(?:ing)?|looks like|not sure|i think)\b/i;
const FILLER = new Set(["a", "an", "the", "of", "some", "and", "my", "our"]);

const FULLNESS_RANK: Record<ShelfFullness, number> = {
  empty: 0,
  low: 1,
  half: 2,
  full: 3,
  unknown: 4,
};

export function shelfPrompt(): string {
  const names = PREFERENCE_CATEGORIES.map((row) => row.label).join(", ");
  return [
    "You are looking at a photo of a fridge, freezer, or pantry shelf.",
    "Return JSON only.",
    '{"items":[{"name":"","family":"","confidence":"high","fullness":"unknown"}]}',
    "name is one grocery you can actually see, such as milk, eggs, butter, ketchup, cheese, or bread.",
    `family is one of: ${names}.`,
    "confidence is high only when that grocery is clear. Use low when it is blurry, partly hidden, or you are not sure.",
    "fullness is full, half, low, or empty when you can see how full the container is. Use unknown when you cannot.",
    "List each distinct grocery once.",
    "Do not invent items that are not visible.",
    "Do not guess brands.",
    "Do not suggest meals, recipes, or what to cook.",
    "Skip shelves, appliances, and containers you cannot name.",
  ].join(" ");
}

function clean(value: unknown, max = 80): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function hedged(name: string): { text: string; unsure: boolean } {
  const unsure = HEDGE.test(name);
  const text = name.replace(HEDGE, " ").replace(/\s+/g, " ").trim();
  return { text, unsure };
}

export function fullnessOf(value: unknown): ShelfFullness {
  const text = clean(value, 40).toLowerCase();
  if (!text || text === "unknown" || text === "unsure" || text === "n/a") return "unknown";
  if (/(?:almost|nearly|running)\s+(?:empty|out)|\brunning low\b|\blow\b/.test(text)) return "low";
  if (/\b(?:empty|out|none|bare|gone)\b/.test(text)) return "empty";
  if (/\bhalf\b/.test(text)) return "half";
  if (/\b(?:full|plenty|stocked)\b/.test(text)) return "full";
  return "unknown";
}

function labelHit(name: string): string {
  const labels = PREFERENCE_CATEGORIES.map((row) => ({ id: row.id, label: row.label })).sort(
    (a, b) => b.label.length - a.label.length
  );
  for (const row of labels) {
    const pattern = new RegExp(`\\b${row.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(name)) return row.id;
  }
  return "";
}

/** Map a sighting to a staple. An unrecognizable name is dropped. */
export function familyForSighting(name: string): string {
  const text = clean(name);
  if (!text) return "";
  const direct = familyFromQuery(text);
  if (direct) return direct;
  const labeled = labelHit(text);
  if (labeled) return labeled;
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter((token) => token && !FILLER.has(token));
  for (let index = 0; index < tokens.length; index += 1) {
    const pair = tokens.slice(index, index + 2).join(" ");
    const two = pair.includes(" ") ? familyFromQuery(pair) : "";
    if (two) return two;
    const one = familyFromQuery(tokens[index] || "");
    if (one) return one;
  }
  return "";
}

function confidenceOf(value: unknown, unsure: boolean): ShelfConfidence {
  if (unsure) return "low";
  return clean(value, 20).toLowerCase() === "high" ? "high" : "low";
}

function mapRow(row: unknown): ShelfItem | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const fields = row as Record<string, unknown>;
  const original = clean(fields.name || fields.item || fields.grocery);
  if (!original) return null;
  const { text, unsure } = hedged(original);
  const family = familyForSighting(text);
  if (!family) return null;
  const label = familyLabel(family) || text;
  const confidence = confidenceOf(fields.confidence, unsure);
  return {
    name: label,
    family,
    label,
    confidence,
    fullness: fullnessOf(fields.fullness ?? fields.fill ?? fields.level),
    unsure: confidence === "low",
  };
}

function emptier(left: ShelfFullness, right: ShelfFullness): ShelfFullness {
  if (left === "unknown") return right;
  if (right === "unknown") return left;
  return FULLNESS_RANK[left] <= FULLNESS_RANK[right] ? left : right;
}

function combine(left: ShelfItem, right: ShelfItem): ShelfItem {
  const confidence: ShelfConfidence = left.confidence === "low" || right.confidence === "low" ? "low" : "high";
  return {
    ...left,
    confidence,
    fullness: emptier(left.fullness, right.fullness),
    unsure: confidence === "low",
  };
}

export function parseShelfScan(input: unknown): ShelfItem[] {
  let payload = input;
  if (typeof input === "string") {
    try {
      payload = parseModelJson(input);
    } catch {
      return [];
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const rows = (payload as Record<string, unknown>).items;
  if (!Array.isArray(rows)) return [];
  const seen = new Map<string, ShelfItem>();
  for (const row of rows.slice(0, 80)) {
    const mapped = mapRow(row);
    if (!mapped) continue;
    const prev = seen.get(mapped.family);
    seen.set(mapped.family, prev ? combine(prev, mapped) : mapped);
  }
  return [...seen.values()].slice(0, 40);
}
