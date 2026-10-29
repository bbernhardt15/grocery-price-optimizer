/**
 * Preview for the ask box. The server owns the ingredient list.
 * Keep titles, blurbs, and aliases aligned with src/import/mealIdeas.ts.
 */

const MEALS = [
  { title: "Taco night", blurb: "Ground beef, cheese, and chips.", aliases: ["taco night", "taco tuesday", "taco dinner", "tacos for dinner"], items: [item("ground beef", "ground-beef"), item("cheddar", "cheese"), item("potato chips", "chips")] },
  { title: "Breakfast", blurb: "Eggs, bread, milk, bananas, and coffee.", aliases: ["breakfast", "breakfast basics"], items: [item("large eggs", "eggs"), item("sandwich bread", "bread"), item("whole milk", "milk"), item("bananas", "bananas"), item("ground coffee", "coffee")] },
  { title: "Cookout", blurb: "Ground beef, chips, soda, and ketchup.", aliases: ["cookout", "cook out", "bbq", "barbecue", "barbeque", "burger night"], items: [item("ground beef", "ground-beef"), item("potato chips", "chips"), item("cola", "soda"), item("ketchup", "ketchup")] },
  { title: "Weeknight dinner", blurb: "Chicken, pasta, and bread.", aliases: ["dinner", "weeknight", "weeknight dinner", "weeknight dinners", "dinner tonight"], items: [item("chicken breast", "chicken"), item("spaghetti", "pasta"), item("sandwich bread", "bread")] },
  { title: "Pasta night", blurb: "Spaghetti, cheese, and bread.", aliases: ["pasta night", "spaghetti night", "spaghetti dinner"], items: [item("spaghetti", "pasta"), item("cheddar", "cheese"), item("sandwich bread", "bread")] },
  { title: "Movie night", blurb: "Chips and soda.", aliases: ["movie night"], items: [item("potato chips", "chips"), item("cola", "soda")] },
  { title: "Game day", blurb: "Wings, chips, and soda.", aliases: ["game day", "super bowl", "wing night"], items: [item("chicken wings", "chicken"), item("potato chips", "chips"), item("cola", "soda")] },
  { title: "Birthday party", blurb: "Chips and soda.", aliases: ["birthday", "birthday party"], items: [item("potato chips", "chips"), item("cola", "soda")] },
  { title: "Lunch", blurb: "Bread and chips.", aliases: ["lunch", "lunches", "back to school", "back to school lunches"], items: [item("sandwich bread", "bread"), item("potato chips", "chips")] },
  { title: "Holiday baking", blurb: "Butter, eggs, and milk.", aliases: ["holiday baking", "baking"], items: [item("salted butter", "butter"), item("large eggs", "eggs"), item("whole milk", "milk")] },
];

function item(raw, family) {
  return { raw, family };
}

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12 };
const FILLER = /^(?:please|hey|ok|okay|um|so)\s+/;
const INTENT =
  /^(?:i(?:'d| would)?\s+(?:like|love|need|want)(?:\s+to(?:\s+make|\s+do)?)?|we(?:'d| would)?\s+(?:like|need|want)|let's|lets|let\s+us|can\s+we(?:\s+please)?|could\s+we|plan(?:\s+for)?|make|do|have|get(?:\s+me)?|shopping\s+for|how\s+about|what\s+about)\s+/;
const ARTICLE = /^(?:a|an|the|some)\s+/;
const PARTY =
  /\bfor\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a\s+dozen|dozen)\s*(?:people|guests|adults|kids|servings?)?\b/;
const TAIL = /\b(?:tonight|today|this\s+weekend|please|thanks|thank\s+you)\b/g;

const ALIASES = MEALS.flatMap((meal) => meal.aliases.map((alias) => ({ alias, meal }))).sort((a, b) => b.alias.length - a.alias.length);

function clean(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[.?!]+/g, " ")
    .replace(/[-/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function peopleCount(token) {
  const word = String(token || "").replace(/^a\s+/, "").toLowerCase();
  if (/^\d{1,2}$/.test(word)) {
    const value = Number(word);
    return value >= 1 && value <= 24 ? value : null;
  }
  return WORDS[word] ?? null;
}

export function mealPreviews() {
  return MEALS.map((meal) => ({ title: meal.title, blurb: meal.blurb, aliases: [...meal.aliases] }));
}

/** @param {string | null | undefined} raw */
export function describeMeal(raw) {
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
  return { title: found.meal.title, people, namedPeople, blurb: found.meal.blurb };
}

/** Ingredients for a meal phrase. Each raw line is a staple family query. */
export function mealPlan(raw) {
  const preview = describeMeal(raw);
  if (!preview) return null;
  const meal = MEALS.find((row) => row.title === preview.title);
  if (!meal) return null;
  return { ...preview, items: meal.items.map((row) => ({ raw: row.raw, family: row.family })) };
}
