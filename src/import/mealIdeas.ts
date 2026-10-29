/**
 * Turns a short meal goal ("taco night for 6") into a shoppable list.
 * Quantities follow the same packs-per-people rule as starter lists.
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
  {
    title: "Taco night",
    blurb: "Ground beef, tortillas, salsa, cheese, and chips.",
    aliases: ["taco night", "taco tuesday", "taco dinner", "tacos for dinner"],
    items: [
      { label: "Ground beef", search: "ground beef", serves: 4 },
      { label: "Tortillas", search: "flour tortillas", serves: 4 },
      { label: "Salsa", search: "mild salsa", serves: 4 },
      { label: "Cheese", search: "shredded cheddar", serves: 4 },
      { label: "Chips", search: "potato chips", serves: 4 },
    ],
  },
  {
    title: "Breakfast",
    blurb: "Eggs, bread, milk, bananas, coffee, and juice.",
    aliases: ["breakfast", "breakfast basics"],
    items: [
      { label: "Eggs", search: "large eggs", serves: 4 },
      { label: "Bread", search: "sandwich bread", serves: 4 },
      { label: "Milk", search: "whole milk", serves: 4 },
      { label: "Bananas", search: "bananas", serves: 4 },
      { label: "Coffee", search: "ground coffee", serves: 8 },
      { label: "Juice", search: "orange juice", serves: 4 },
    ],
  },
  {
    title: "Cookout",
    blurb: "Beef, buns, chips, soda, and ketchup.",
    aliases: ["cookout", "cook out", "bbq", "barbecue", "barbeque", "burger night"],
    items: [
      { label: "Ground beef", search: "ground beef", serves: 4 },
      { label: "Buns", search: "burger buns", serves: 8 },
      { label: "Chips", search: "potato chips", serves: 4 },
      { label: "Soda", search: "coca-cola", serves: 6 },
      { label: "Ketchup", search: "ketchup", serves: 12 },
    ],
  },
  {
    title: "Weeknight dinner",
    blurb: "Chicken, pasta, salad, and bread.",
    aliases: ["dinner", "weeknight", "weeknight dinner", "weeknight dinners", "dinner tonight"],
    items: [
      { label: "Chicken", search: "chicken breast", serves: 4 },
      { label: "Pasta", search: "spaghetti", serves: 4 },
      { label: "Salad", search: "baby spinach", serves: 4 },
      { label: "Bread", search: "sandwich bread", serves: 4 },
    ],
  },
  {
    title: "Pasta night",
    blurb: "Spaghetti, cheese, salad, and bread.",
    aliases: ["pasta night", "spaghetti night", "spaghetti dinner"],
    items: [
      { label: "Pasta", search: "spaghetti", serves: 4 },
      { label: "Cheese", search: "shredded cheddar", serves: 4 },
      { label: "Salad", search: "baby spinach", serves: 4 },
      { label: "Bread", search: "sandwich bread", serves: 4 },
    ],
  },
  {
    title: "Movie night",
    blurb: "Popcorn, soda, chocolate, and ice cream.",
    aliases: ["movie night"],
    items: [
      { label: "Popcorn", search: "microwave popcorn", serves: 4 },
      { label: "Soda", search: "coca-cola", serves: 6 },
      { label: "Chocolate", search: "milk chocolate", serves: 4 },
      { label: "Ice cream", search: "vanilla ice cream", serves: 6 },
    ],
  },
  {
    title: "Game day",
    blurb: "Wings, chips, dip, soda, and cookies.",
    aliases: ["game day", "super bowl", "wing night"],
    items: [
      { label: "Wings", search: "chicken wings", serves: 4 },
      { label: "Chips", search: "potato chips", serves: 4 },
      { label: "Dip", search: "ranch dip", serves: 6 },
      { label: "Soda", search: "coca-cola", serves: 6 },
      { label: "Cookies", search: "oreo", serves: 6 },
    ],
  },
  {
    title: "Birthday party",
    blurb: "Cake, ice cream, chips, soda, and plates.",
    aliases: ["birthday", "birthday party"],
    items: [
      { label: "Cake", search: "vanilla cake mix", serves: 8 },
      { label: "Ice cream", search: "vanilla ice cream", serves: 6 },
      { label: "Chips", search: "potato chips", serves: 4 },
      { label: "Soda", search: "coca-cola", serves: 6 },
      { label: "Plates", search: "paper plates", serves: 8 },
    ],
  },
  {
    title: "Lunch",
    blurb: "Bread, turkey, apples, and juice.",
    aliases: ["lunch", "lunches", "back to school", "back to school lunches"],
    items: [
      { label: "Bread", search: "sandwich bread", serves: 4 },
      { label: "Turkey", search: "sliced turkey", serves: 4 },
      { label: "Apples", search: "gala apples", serves: 4 },
      { label: "Juice", search: "orange juice", serves: 4 },
    ],
  },
  {
    title: "Holiday baking",
    blurb: "Flour, sugar, butter, eggs, chocolate chips, and milk.",
    aliases: ["holiday baking", "baking"],
    items: [
      { label: "Flour", search: "all-purpose flour", serves: 8 },
      { label: "Sugar", search: "granulated sugar", serves: 8 },
      { label: "Butter", search: "salted butter", serves: 8 },
      { label: "Eggs", search: "large eggs", serves: 4 },
      { label: "Chocolate chips", search: "semi-sweet chocolate chips", serves: 8 },
      { label: "Milk", search: "whole milk", serves: 4 },
    ],
  },
  {
    title: "Thanksgiving",
    blurb: "Turkey, stuffing, cranberry, potatoes, rolls, and pie.",
    aliases: ["thanksgiving", "thanksgiving dinner"],
    items: [
      { label: "Turkey", search: "whole turkey", serves: 12 },
      { label: "Stuffing", search: "stuffing mix", serves: 8 },
      { label: "Cranberry sauce", search: "cranberry sauce", serves: 8 },
      { label: "Potatoes", search: "russet potatoes", serves: 6 },
      { label: "Dinner rolls", search: "dinner rolls", serves: 6 },
      { label: "Green beans", search: "green beans", serves: 4 },
      { label: "Butter", search: "salted butter", serves: 8 },
      { label: "Pie crust", search: "pie crust", serves: 8 },
      { label: "Whipped topping", search: "whipped topping", serves: 8 },
    ],
  },
];

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
