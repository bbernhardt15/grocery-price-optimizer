/**
 * Preview for the ask box. The server owns the ingredient list.
 * Keep titles, blurbs, and aliases aligned with src/import/mealIdeas.ts.
 */

const MEALS = [
  { title: "Taco night", blurb: "Ground beef, tortillas, salsa, cheese, and chips.", aliases: ["taco night", "taco tuesday", "taco dinner", "tacos for dinner"] },
  { title: "Breakfast", blurb: "Eggs, bread, milk, bananas, coffee, and juice.", aliases: ["breakfast", "breakfast basics"] },
  { title: "Cookout", blurb: "Beef, buns, chips, soda, and ketchup.", aliases: ["cookout", "cook out", "bbq", "barbecue", "barbeque", "burger night"] },
  { title: "Weeknight dinner", blurb: "Chicken, pasta, salad, and bread.", aliases: ["dinner", "weeknight", "weeknight dinner", "weeknight dinners", "dinner tonight"] },
  { title: "Pasta night", blurb: "Spaghetti, cheese, salad, and bread.", aliases: ["pasta night", "spaghetti night", "spaghetti dinner"] },
  { title: "Movie night", blurb: "Popcorn, soda, chocolate, and ice cream.", aliases: ["movie night"] },
  { title: "Game day", blurb: "Wings, chips, dip, soda, and cookies.", aliases: ["game day", "super bowl", "wing night"] },
  { title: "Birthday party", blurb: "Cake, ice cream, chips, soda, and plates.", aliases: ["birthday", "birthday party"] },
  { title: "Lunch", blurb: "Bread, turkey, apples, and juice.", aliases: ["lunch", "lunches", "back to school", "back to school lunches"] },
  { title: "Holiday baking", blurb: "Flour, sugar, butter, eggs, chocolate chips, and milk.", aliases: ["holiday baking", "baking"] },
  { title: "Thanksgiving", blurb: "Turkey, stuffing, cranberry, potatoes, rolls, and pie.", aliases: ["thanksgiving", "thanksgiving dinner"] },
];

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
