/**
 * Recognizes a meal phrase such as "taco night for 6".
 * The ask box resolves the staple queries through saved preferences.
 * A grocery list or a single product is left alone.
 */

import type { ParsedImportItem } from "./parseImportText";

export type MealIdea = {
  title: string;
  people: number;
  /** True when the shopper named a headcount. */
  namedPeople: boolean;
  blurb: string;
};

export type MealPlan = {
  idea: MealIdea;
  items: ParsedImportItem[];
};

type Ingredient = { label: string; search: string; serves: number };

type Meal = {
  title: string;
  blurb: string;
  aliases: string[];
  items: Ingredient[];
};

const MEALS: Meal[] = [
  meal("Taco night", "Ground beef, cheese, and chips.", ["taco night", "taco tuesday", "taco dinner", "tacos for dinner"], ["ground beef", "cheddar", "potato chips"]),
  meal("Breakfast", "Eggs, bread, milk, bananas, and coffee.", ["breakfast", "breakfast basics"], ["large eggs", "sandwich bread", "whole milk", "bananas", "ground coffee"]),
  meal("Cookout", "Ground beef, chips, soda, and ketchup.", ["cookout", "cook out", "bbq", "barbecue", "barbeque", "burger night"], ["ground beef", "potato chips", "cola", "ketchup"]),
  meal("Weeknight dinner", "Chicken, pasta, and bread.", ["dinner", "weeknight", "weeknight dinner", "weeknight dinners", "dinner tonight"], ["chicken breast", "spaghetti", "sandwich bread"]),
  meal("Pasta night", "Spaghetti, cheese, and bread.", ["pasta night", "spaghetti night", "spaghetti dinner"], ["spaghetti", "cheddar", "sandwich bread"]),
  meal("Movie night", "Chips and soda.", ["movie night"], ["potato chips", "cola"]),
  meal("Game day", "Wings, chips, and soda.", ["game day", "super bowl", "wing night"], ["chicken wings", "potato chips", "cola"]),
  meal("Birthday party", "Chips and soda.", ["birthday", "birthday party"], ["potato chips", "cola"]),
  meal("Lunch", "Bread and chips.", ["lunch", "lunches", "back to school", "back to school lunches"], ["sandwich bread", "potato chips"]),
  meal("Holiday baking", "Butter, eggs, and milk.", ["holiday baking", "baking"], ["salted butter", "large eggs", "whole milk"]),
];

function meal(title: string, blurb: string, aliases: string[], searches: string[]): Meal {
  return {
    title,
    blurb,
    aliases,
    items: searches.map((search) => ({ label: search, search, serves: 4 })),
  };
}

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
  dozen: 12,
};

const FILLER = /^(?:please|hey|ok|okay|um|so)\s+/;
const INTENT =
  /^(?:i(?:'d| would)?\s+(?:like|love|need|want)(?:\s+to(?:\s+make|\s+do)?)?|we(?:'d| would)?\s+(?:like|need|want)|let's|lets|let\s+us|can\s+we(?:\s+please)?|could\s+we|plan(?:\s+for)?|make|do|have|get(?:\s+me)?|shopping\s+for|how\s+about|what\s+about)\s+/;
const ARTICLE = /^(?:a|an|the|some)\s+/;
const PARTY =
  /\bfor\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a\s+dozen|dozen)\s*(?:people|guests|adults|kids|servings?)?\b/;
const TAIL = /\b(?:tonight|today|this\s+weekend|please|thanks|thank\s+you)\b/g;

const ALIASES = MEALS.flatMap((meal) => meal.aliases.map((alias) => ({ alias, meal }))).sort(
  (a, b) => b.alias.length - a.alias.length
);

function clean(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.?!]+/g, " ")
    .replace(/[-/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function packagesFor(serves: number, people: number): number {
  const party = Math.min(24, Math.max(1, people));
  const cover = Math.min(99, Math.max(1, serves));
  return Math.min(99, Math.max(1, Math.ceil(party / cover)));
}

function peopleCount(token: string): number | null {
  const word = token.replace(/^a\s+/, "").toLowerCase();
  if (/^\d{1,2}$/.test(word)) {
    const value = Number(word);
    return value >= 1 && value <= 24 ? value : null;
  }
  return WORDS[word] ?? null;
}

/** Titles and phrases the ask box can preview. Items stay on the server. */
export function mealPreviews(): Array<{ title: string; blurb: string; aliases: string[] }> {
  return MEALS.map((meal) => ({ title: meal.title, blurb: meal.blurb, aliases: [...meal.aliases] }));
}

/**
 * A meal goal becomes ingredients. Anything else returns null so the
 * normal list reader can keep the shopper's own words.
 */
export function mealFromAsk(raw: string | null | undefined): MealPlan | null {
  const original = String(raw ?? "");
  if (/[,;\n•]/.test(original)) return null;
  let text = clean(original);
  if (!text || text.length > 80) return null;
  for (let i = 0; i < 6; i += 1) {
    const next = text.replace(FILLER, "").replace(INTENT, "").replace(ARTICLE, "").trim();
    if (next === text) break;
    text = next;
  }
  let namedPeople = false;
  let people = 4;
  const party = text.match(PARTY);
  if (party?.[1]) {
    const count = peopleCount(party[1]);
    if (!count) return null;
    namedPeople = true;
    people = count;
    text = text.replace(party[0], " ").replace(/\s+/g, " ").trim();
  }
  text = text.replace(TAIL, " ").replace(/\s+/g, " ").trim();
  const found = ALIASES.find((row) => row.alias === text);
  if (!found) return null;
  const items: ParsedImportItem[] = found.meal.items.map((item) => ({
    raw: item.label,
    name: item.search,
    quantity: packagesFor(item.serves, people),
  }));
  return {
    idea: { title: found.meal.title, people, namedPeople, blurb: found.meal.blurb },
    items,
  };
}
