/**
 * One Add field. A short product name searches the shelf.
 * A meal goal or a list uses the same matcher as Import.
 * Nothing here invents a product.
 */

import { describeMeal } from "./mealIdeas.js";

const COMPOUND =
  /^(?:bread and butter|mac and cheese|salt and pepper|fish and chips|pork and beans|sweet and sour|peanut butter and jelly)$/i;

/**
 * @param {string | null | undefined} raw
 * @returns {"empty" | "search" | "list"}
 */
export function askIntent(raw) {
  const original = String(raw ?? "");
  const text = original.replace(/\s+/g, " ").trim();
  if (!text) return "empty";
  if (describeMeal(text)) return "list";
  if (/[,;\n•]/.test(original)) return "list";
  if (/\bfor\s+\d{1,2}\b/i.test(text)) return "list";
  const words = text.split(/\s+/);
  if (/[.?!]/.test(text) && words.length >= 3) return "list";
  if (words.length >= 5) return "list";
  if (
    words.length >= 3 &&
    /\b(night|dinner|lunch|breakfast|brunch|party|picnic|recipe|meal|guests?)\b/i.test(text)
  ) {
    return "list";
  }
  if (/\band\b/i.test(text) && words.length >= 3 && !COMPOUND.test(text)) return "list";
  return "search";
}
